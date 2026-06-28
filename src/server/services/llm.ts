import { config } from '../config.js';
// Type-only — erased at compile time, so it doesn't defeat the lazy client load.
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Thin wrapper over the Anthropic API. Callers must check
 * `anthropicAvailable()` and provide their own deterministic stub behavior
 * when it returns false (mock mode without a key must never crash).
 */

export function anthropicAvailable(): boolean {
  return !!config().anthropicApiKey;
}

let clientPromise: Promise<import('@anthropic-ai/sdk').default> | undefined;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk').then(
      ({ default: Anthropic }) => new Anthropic({ apiKey: config().anthropicApiKey }),
    );
  }
  return clientPromise;
}

/**
 * The model that last worked, cached for the rest of the process so a retired
 * primary isn't re-paid on every request. Reset if it later goes unavailable.
 */
let resolvedModel: string | undefined;

/**
 * A retired/unknown model returns HTTP 404 with `error.type === 'not_found_error'`.
 * Detected robustly without needing the SDK error class at runtime.
 */
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; error?: { error?: { type?: string } }; message?: string };
  if (e?.status === 404) return true;
  if (e?.error?.error?.type === 'not_found_error') return true;
  const m = (e?.message ?? '').toLowerCase();
  return m.includes('not_found_error') || (m.includes('model') && m.includes('deprecat'));
}

/**
 * Self-healing wrapper over `messages.create`: the single Claude call path for
 * the app. Tries the last-working model, then the configured primary, then the
 * fallback chain, advancing only on a model-not-found error and remembering the
 * model that succeeds. Every other error (auth, rate limit, validation, network)
 * is surfaced immediately — we never burn through the whole chain (and the user's
 * money on every tier) masking a real problem.
 */
async function createMessage(
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>,
): Promise<Anthropic.Message> {
  const cfg = config();
  const chain = [resolvedModel, cfg.anthropicModel, ...cfg.anthropicModelFallbacks]
    .filter((m): m is string => !!m)
    .filter((m, i, a) => a.indexOf(m) === i); // dedupe, preserve order
  const client = await getClient();
  let lastErr: unknown;
  for (const model of chain) {
    try {
      const res = await client.messages.create({ ...params, model });
      if (resolvedModel !== model) {
        if (resolvedModel) console.warn(`[llm] model "${resolvedModel}" → using "${model}"`);
        resolvedModel = model;
      }
      return res;
    } catch (err) {
      if (isModelUnavailable(err)) {
        console.warn(
          `[llm] model "${model}" unavailable (retired/not found) — trying next fallback`,
        );
        if (resolvedModel === model) resolvedModel = undefined;
        lastErr = err;
        continue; // try next model in chain
      }
      throw err; // auth / rate-limit / validation / network — surface immediately
    }
  }
  throw new Error(
    `All Anthropic models failed as unavailable: ${chain.join(', ')}. ` +
      `Update ANTHROPIC_MODEL / ANTHROPIC_MODEL_FALLBACKS. Last error: ${String(lastErr)}`,
  );
}

export interface GenerateOptions {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  if (!anthropicAvailable()) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  const res = await createMessage({
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  return res.content
    .filter((b): b is { type: 'text'; text: string } & typeof b => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * OCR photographed SOP pages with Claude vision. Pages are transcribed in
 * order and joined. Requires ANTHROPIC_API_KEY — image ingestion fails with
 * a clear error without it (PDF/DOCX ingestion still works keyless).
 */
export async function ocrImagesToMarkdown(
  images: Array<{ data: Buffer; mediaType: VisionMediaType }>,
  instruction: string,
): Promise<string> {
  if (!anthropicAvailable()) {
    throw new Error(
      'OCR of photographed SOPs requires ANTHROPIC_API_KEY (PDF and DOCX ingestion work without it)',
    );
  }
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: VisionMediaType; data: string } }
    | { type: 'text'; text: string }
  > = images.map((img) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mediaType,
      data: img.data.toString('base64'),
    },
  }));
  content.push({ type: 'text', text: instruction });
  const res = await createMessage({
    max_tokens: 8192,
    temperature: 0,
    messages: [{ role: 'user', content }],
  });
  return res.content
    .filter((b): b is { type: 'text'; text: string } & typeof b => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Extract the first JSON value (object or array) from an LLM response. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in LLM response');
  // Walk to the matching close bracket.
  const open = candidate[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
    } else if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error('Unbalanced JSON in LLM response');
}
