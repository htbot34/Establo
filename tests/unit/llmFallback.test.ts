import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the self-healing model chain in services/llm.ts. We mock the
 * Anthropic SDK so each `messages.create` outcome is under our control, set a
 * key so `anthropicAvailable()` is true, and `vi.resetModules()` between cases
 * because both the SDK client and the resolved-model cache live in module scope.
 */

// Shared mock for messages.create — hoisted so the vi.mock factory can close
// over it. Reconfigured per test; the SDK client is module-cached, this isn't.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: createMock };
    constructor(_opts?: unknown) {}
  }
  return { default: Anthropic };
});

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_FALLBACKS'] as const;
const saved: Record<string, string | undefined> = {};

const notFound = {
  status: 404,
  error: { type: 'error', error: { type: 'not_found_error', message: 'model: ...' } },
  message: '404 not_found_error',
};

const okText = (model: string) => ({ content: [{ type: 'text', text: `answer from ${model}` }] });

/** Fresh llm module each call — picks up reset module state (resolvedModel/client). */
async function loadLlm() {
  return import('../../src/server/services/llm.js');
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
  process.env.ANTHROPIC_MODEL_FALLBACKS = 'claude-sonnet-4-6,claude-opus-4-8';
  vi.resetModules();
  createMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('createMessage fallback chain', () => {
  it('falls back to the next model on a 404 and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockImplementation(async ({ model }: { model: string }) => {
      if (model === 'claude-haiku-4-5-20251001') throw notFound;
      return okText(model);
    });

    const { generateText } = await loadLlm();
    const out = await generateText({ user: '¿Cuánto pre-dip?' });

    // Returned the fallback model's answer, not an error/disclosure.
    expect(out).toBe('answer from claude-sonnet-4-6');
    // Primary was attempted, then the fallback.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
    expect(createMock.mock.calls[1][0].model).toBe('claude-sonnet-4-6');
    // A loud warning was logged about the retired primary.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('claude-haiku-4-5-20251001'))).toBe(
      true,
    );
  });

  it('caches the working model so the dead primary is not re-tried', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockImplementation(async ({ model }: { model: string }) => {
      if (model === 'claude-haiku-4-5-20251001') throw notFound;
      return okText(model);
    });

    const { generateText } = await loadLlm();
    await generateText({ user: 'uno' }); // primary fails once, resolves to sonnet
    createMock.mockClear();
    await generateText({ user: 'dos' }); // should go straight to sonnet

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('surfaces a non-model error immediately without trying any fallback', async () => {
    const badRequest = {
      status: 400,
      error: { type: 'error', error: { type: 'invalid_request_error' } },
      message: 'temperature: must be <= 1',
    };
    createMock.mockRejectedValue(badRequest);

    const { generateText } = await loadLlm();
    await expect(generateText({ user: 'hola' })).rejects.toBe(badRequest);
    // No fallback attempted — exactly one call.
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws the aggregated error when every model is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockRejectedValue(notFound);

    const { generateText } = await loadLlm();
    await expect(generateText({ user: 'hola' })).rejects.toThrow(
      /All Anthropic models failed as unavailable/,
    );
    // Tried every model in the chain (primary + 2 fallbacks).
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('ocrImagesToMarkdown routes through the same chain', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMock.mockImplementation(async ({ model }: { model: string }) => {
      if (model === 'claude-haiku-4-5-20251001') throw notFound;
      return { content: [{ type: 'text', text: `# OCR via ${model}` }] };
    });

    const { ocrImagesToMarkdown } = await loadLlm();
    const md = await ocrImagesToMarkdown(
      [{ data: Buffer.from('x'), mediaType: 'image/png' }],
      'Transcribe',
    );

    expect(md).toBe('# OCR via claude-sonnet-4-6');
    expect(createMock.mock.calls[1][0].model).toBe('claude-sonnet-4-6');
  });
});
