import { createHash } from 'node:crypto';
import { config } from '../config.js';

export const EMBEDDING_DIMS = 1536;

/** True when no OPENAI_API_KEY is configured and the local stub is in use. */
export function usingStubEmbeddings(): boolean {
  return !config().openaiApiKey;
}

/**
 * Default similarity floor below which Establo refuses to answer.
 * Real embeddings produce meaningful cosine scores; the hash stub's scores
 * are much weaker, so the floor drops accordingly.
 */
export function retrievalMinSimilarity(): number {
  const override = config().retrievalMinSimilarity;
  if (override !== undefined) return override;
  return usingStubEmbeddings() ? 0.02 : 0.25;
}

function normalizeForStub(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents: ordeño → ordeno
    .replace(/[^a-z0-9ñ\s]/g, ' ');
}

const STUB_STOPWORDS = new Set(
  ('el la los las un una unos unas de del al a en y o u que se su sus con por para como es son ' +
    'fue ser estar esta este esto hay si no mas pero cuando donde cual cuales quien debe deben ' +
    'cada the of and or to in is are was for with on at it this that').split(' '),
);

function hashToIndex(token: string, salt: number): number {
  const h = createHash('sha1').update(`${salt}:${token}`).digest();
  return h.readUInt32BE(0) % EMBEDDING_DIMS;
}

/**
 * Deterministic local pseudo-embedding (bag of words + char trigrams hashed
 * into 1536 dims, L2-normalized). Retrieval works "poorly but functionally"
 * for keyless smoke tests — this is NOT a real embedding.
 */
export function stubEmbedding(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMS);
  const words = normalizeForStub(text)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STUB_STOPWORDS.has(w));
  for (const word of words) {
    for (let salt = 0; salt < 2; salt++) {
      vec[hashToIndex(word, salt)] += 1;
    }
    // char trigrams catch stem overlap (ordeño/ordeñar, becerra/becerras)
    const padded = `_${word}_`;
    for (let i = 0; i <= padded.length - 3; i++) {
      vec[hashToIndex(padded.slice(i, i + 3), 7)] += 0.35;
    }
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config().openaiApiKey });
  const res = await client.embeddings.create({
    model: config().openaiEmbeddingModel,
    input: texts,
  });
  const sorted = [...res.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/** Embed a batch of texts — real OpenAI embeddings when a key is set, stub otherwise. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (usingStubEmbeddings()) return texts.map(stubEmbedding);
  const out: number[][] = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await openaiEmbed(texts.slice(i, i + BATCH))));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}
