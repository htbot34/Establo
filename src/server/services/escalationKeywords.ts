import type { Db } from '../db/client.js';
import { escalations, type FarmTopic } from '../db/schema.js';
import { logTrainingEvent } from './trainingEvents.js';

/**
 * Org-configurable forced-escalation keywords. A manager lists farm-specific
 * words in Settings (a chemical, a machine, a sensitive topic); any question
 * containing one still gets its normal answer when retrieval is confident,
 * but ALWAYS creates an escalation so the supervisor sees it — visibility,
 * not a gag. Matching mirrors the hard guard's normalization
 * (services/guards.ts): accent-stripped lowercase with word boundaries, so
 * "ácido" matches "ACIDO" but "gas" never fires inside "gastamos".
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * First configured keyword that appears (whole-word) in the text, or null.
 * Returns the keyword AS THE MANAGER TYPED IT so the escalation reason shows
 * their own spelling, not the normalized form.
 */
export function matchEscalationKeyword(text: string, keywords: string[]): string | null {
  const t = normalize(text);
  if (!t) return null;
  for (const keyword of keywords) {
    const k = normalize(keyword);
    if (!k) continue;
    // Lookarounds instead of \b: they enforce the same word boundary but
    // still work when a keyword starts/ends with a non-word character
    // ("lavado (cip)"), where \b would silently never match.
    if (new RegExp(`(?<!\\w)${escapeRegExp(k)}(?!\\w)`).test(t)) return keyword;
  }
  return null;
}

export interface KeywordEscalationInput {
  orgId: string;
  workerId: string;
  questionText: string;
  /** The configured keyword that matched (manager's spelling). */
  keyword: string;
  topic: string;
  farmTopic?: FarmTopic;
  confidence?: 'grounded' | 'partial' | 'not_found' | null;
}

/**
 * The escalation row + training event for a keyword hit. Kept next to the
 * matcher (and out of inbound.ts) so the reason string and the event shape
 * are pinned by one unit test rather than re-derived at the call site.
 */
export async function recordKeywordEscalation(
  db: Db,
  input: KeywordEscalationInput,
): Promise<void> {
  await db.insert(escalations).values({
    orgId: input.orgId,
    workerId: input.workerId,
    questionText: input.questionText,
    reason: `Palabra clave configurada por la granja: ${input.keyword}`,
  });
  await logTrainingEvent(db, {
    orgId: input.orgId,
    workerId: input.workerId,
    eventType: 'escalation',
    topic: input.topic,
    farmTopic: input.farmTopic,
    questionText: input.questionText,
    confidence: input.confidence,
  });
}
