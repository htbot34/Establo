import { config } from '../config.js';

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
  const client = await getClient();
  const res = await client.messages.create({
    model: config().anthropicModel,
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
  const client = await getClient();
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
  const res = await client.messages.create({
    model: config().anthropicModel,
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
