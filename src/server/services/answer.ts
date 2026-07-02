import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.js';
import { retrievalMinSimilarity } from './embeddings.js';
import { matchForbiddenTopic, type ForbiddenCategory } from './guards.js';
import { anthropicAvailable, generateText } from './llm.js';
import { ES } from './messages.es.js';
import { retrieveChunks, type RetrievedChunk } from './retrieval.js';
import { classifyTopicByKeywords, isValidTopic, type Topic } from './topics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/answer.es.md');

export type Confidence = 'grounded' | 'partial' | 'not_found';

export interface AnswerResult {
  text: string;
  confidence: Confidence;
  topic: Topic;
  sourceDocumentId: string | null;
  sourceChunkIds: string[];
  bestSimilarity: number | null;
  usedStub: boolean;
  /** Hit the hard guard (salary/legal/immigration/vet-dosing) — caller must escalate. */
  forbidden: boolean;
  /**
   * Which guard category fired (null when not forbidden). Two categories map
   * to the same topic ('Otro'), so callers that must treat immigration/legal
   * differently (employer-visible redaction) need the category itself.
   */
  forbiddenCategory: ForbiddenCategory | null;
}

let cachedSystemPrompt: string | undefined;
export function answerSystemPrompt(): string {
  if (!cachedSystemPrompt) cachedSystemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  return cachedSystemPrompt;
}

const META_RE = /<meta\s+confidence="(grounded|partial|not_found)"\s+topic="([^"]*)"\s*\/?>/i;

/** Parse + strip the trailing <meta .../> tag the model is instructed to emit. */
export function parseMetaTag(raw: string): {
  text: string;
  confidence: Confidence | null;
  topic: string | null;
} {
  const m = META_RE.exec(raw);
  if (!m) return { text: raw.trim(), confidence: null, topic: null };
  const text = raw.replace(META_RE, '').trim();
  return { text, confidence: m[1].toLowerCase() as Confidence, topic: m[2] };
}

export const CITATION_PREFIX = '📄 Fuente:';

/** Guarantee a citation line on grounded/partial answers (never on refusals). */
export function ensureCitation(text: string, topChunk: RetrievedChunk): string {
  if (text.includes(CITATION_PREFIX)) return text;
  return `${text}\n\n${CITATION_PREFIX} ${topChunk.documentTitle} — ${topChunk.headingPath}`;
}

function buildUserMessage(question: string, chunks: RetrievedChunk[]): string {
  const fragments = chunks
    .map(
      (c, i) =>
        `<fragmento n="${i + 1}" documento="${c.documentTitle}" seccion="${c.headingPath}">\n${c.content}\n</fragmento>`,
    )
    .join('\n\n');
  return `Pregunta del trabajador:\n"""${question}"""\n\nFragmentos de los procedimientos de su lechería:\n${fragments}`;
}

function notFoundResult(question: string, best: number | null): AnswerResult {
  return {
    text: ES.notFound,
    confidence: 'not_found',
    topic: classifyTopicByKeywords(question),
    sourceDocumentId: null,
    sourceChunkIds: [],
    bestSimilarity: best,
    usedStub: !anthropicAvailable(),
    forbidden: false,
    forbiddenCategory: null,
  };
}

/**
 * The grounded answer pipeline: retrieve → similarity floor → Claude with
 * the versioned Spanish grounding prompt → parse <meta/> → enforce citation.
 * Without an Anthropic key it degrades to a deterministic stub that returns
 * the top retrieved chunk verbatim with a [STUB] prefix.
 */
export async function answerQuestion(
  db: Db,
  orgId: string,
  question: string,
): Promise<AnswerResult> {
  const guard = matchForbiddenTopic(question);
  if (guard) {
    return {
      text: ES.forbidden,
      confidence: 'not_found',
      topic: guard.topic,
      sourceDocumentId: null,
      sourceChunkIds: [],
      bestSimilarity: null,
      usedStub: !anthropicAvailable(),
      forbidden: true,
      forbiddenCategory: guard.category,
    };
  }

  const chunks = await retrieveChunks(db, orgId, question);
  if (chunks.length === 0) return notFoundResult(question, null);

  const best = chunks[0].similarity;
  if (best < retrievalMinSimilarity()) return notFoundResult(question, best);

  if (!anthropicAvailable()) {
    const top = chunks[0];
    const excerpt = top.content.length > 420 ? `${top.content.slice(0, 420)}…` : top.content;
    return {
      text: `[STUB] ${excerpt}\n\n${CITATION_PREFIX} ${top.documentTitle} — ${top.headingPath}`,
      confidence: 'grounded',
      topic: classifyTopicByKeywords(`${question} ${top.headingPath}`),
      sourceDocumentId: top.documentId,
      sourceChunkIds: [top.id],
      bestSimilarity: best,
      usedStub: true,
      forbidden: false,
      forbiddenCategory: null,
    };
  }

  const raw = await generateText({
    system: answerSystemPrompt(),
    user: buildUserMessage(question, chunks),
    maxTokens: 700,
  });

  const parsed = parseMetaTag(raw);
  const confidence: Confidence = parsed.confidence ?? 'partial';
  const topic: Topic =
    parsed.topic && isValidTopic(parsed.topic)
      ? parsed.topic
      : classifyTopicByKeywords(question);

  if (confidence === 'not_found') {
    return {
      text: parsed.text || ES.notFound,
      confidence,
      topic,
      sourceDocumentId: null,
      sourceChunkIds: [],
      bestSimilarity: best,
      usedStub: false,
      forbidden: false,
      forbiddenCategory: null,
    };
  }

  return {
    text: ensureCitation(parsed.text, chunks[0]),
    confidence,
    topic,
    sourceDocumentId: chunks[0].documentId,
    sourceChunkIds: chunks.slice(0, 3).map((c) => c.id),
    bestSimilarity: best,
    usedStub: false,
    forbidden: false,
    forbiddenCategory: null,
  };
}
