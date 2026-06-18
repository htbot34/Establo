import { FARM_TOPICS, type FarmTopic } from '../db/schema.js';
import { WORKER_ROLES, type WorkerRole } from './roles.js';
import type { Topic } from './topics.js';

/**
 * FARM Animal Care v5 continuing-education areas. v5 requires annually
 * documented, JOB-SPECIFIC continuing education for each employee with animal-
 * care responsibilities — only in the areas their job actually covers — across
 * general animal care/handling (stockmanship), pre-weaned calf care, non-
 * ambulatory animals, euthanasia, and fitness to transport. If the standard
 * isn't met, v5 triggers a Mandatory Corrective Action Plan with up to a
 * 9-month correction window (shortened from 3 years in v4). Every
 * training_event carries one of these areas so the audit pack can group records
 * the way an evaluator reads them, and flag missing areas against each worker's
 * role (see expectedCeAreasForRole) rather than against all five.
 *
 * Q&A events are classified here with a keyword table over the question text
 * plus the <meta topic/> Claude already returns (NO extra LLM call). Drip
 * modules carry the farm_topic the manager set on the module.
 */

export { FARM_TOPICS, type FarmTopic };

export const FARM_TOPIC_LABELS: Record<FarmTopic, string> = {
  stockmanship_general: 'General animal care & handling (stockmanship)',
  preweaned_calf: 'Pre-weaned calf care',
  non_ambulatory: 'Non-ambulatory animal management',
  euthanasia: 'Euthanasia',
  fitness_to_transport: 'Fitness to transport',
  safety_other: 'Worker safety / other',
  none: 'Not FARM-specific',
};

/** The five areas FARM v5 expects documented CE in (excludes safety_other/none). */
export const FARM_CE_AREAS: FarmTopic[] = [
  'stockmanship_general',
  'preweaned_calf',
  'non_ambulatory',
  'euthanasia',
  'fitness_to_transport',
];

/**
 * Default FARM v5 CE areas implied by a worker's job role. FARM scopes CE to
 * each employee's actual animal-care responsibilities, so the audit pack must
 * not flag, e.g., a milker for missing euthanasia CE. These are sensible
 * per-role DEFAULTS; a farm can refine which employees truly carry which duties.
 */
export const ROLE_CE_AREAS: Record<WorkerRole, FarmTopic[]> = {
  ordeno: ['stockmanship_general'],
  becerras: ['stockmanship_general', 'preweaned_calf'],
  alimentacion: ['stockmanship_general'],
  salud_hato: ['stockmanship_general', 'non_ambulatory', 'euthanasia', 'fitness_to_transport'],
  general: [...FARM_CE_AREAS],
};

const BASELINE_CE_AREAS: FarmTopic[] = ['stockmanship_general'];

/**
 * Expected CE areas for a worker. An unknown/unassigned (null) role gets only
 * the universal baseline (stockmanship) so we never invent obligations we can't
 * support; an assigned role gets its mapped areas.
 */
export function expectedCeAreasForRole(jobRole: string | null | undefined): FarmTopic[] {
  if (jobRole && (WORKER_ROLES as readonly string[]).includes(jobRole)) {
    return ROLE_CE_AREAS[jobRole as WorkerRole];
  }
  return BASELINE_CE_AREAS;
}

export function isValidFarmTopic(t: string): t is FarmTopic {
  return (FARM_TOPICS as readonly string[]).includes(t);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Most-specific first: the four job-specific FARM areas are narrower than
// general stockmanship, so their keywords win.
const KEYWORD_RULES: Array<{ farmTopic: FarmTopic; patterns: RegExp[] }> = [
  {
    farmTopic: 'euthanasia',
    patterns: [/eutanasia/, /sacrific/, /poner a dormir/, /matar (a |una |la )?(vaca|becerr|animal)/],
  },
  {
    farmTopic: 'non_ambulatory',
    patterns: [
      /vaca(s)? caida/, /no se (puede |pueden )?para/, /no ambulator/, /\bcaida\b/,
      /se resbalo y (no|queda)/, /\bdowner\b/, /arrastr/, /camilla|tablero/,
    ],
  },
  {
    farmTopic: 'fitness_to_transport',
    patterns: [
      /transport/, /embarcar/, /\bcamion\b/, /\bviaje\b/, /aptitud para (el )?transporte/,
      /mandar al rastro/, /llevar al mercado/,
    ],
  },
  {
    farmTopic: 'preweaned_calf',
    patterns: [/becerr/, /ternero|ternera/, /calostro/, /ombligo/, /destete/, /recien nacid/],
  },
  {
    farmTopic: 'stockmanship_general',
    patterns: [
      /zona de fuga/, /punto de balance/, /arrear|arreo/, /mover (las )?vacas/, /bajo estres/,
      /chicharra|picana/, /bienestar animal/, /manejo de animales/, /mastitis/, /cojera|coja/,
      /\bcuidado de (las )?vacas\b/,
    ],
  },
];

// The Spanish Q&A taxonomy (prompts/answer.es.md <meta topic/>) → FARM area.
// Milking/hygiene/equipment topics are milk-quality training, not FARM animal
// care CE, so they map to none; chemicals map to worker safety.
const TOPIC_TABLE: Record<Topic, FarmTopic> = {
  'Manejo de animales': 'stockmanship_general',
  'Salud animal': 'stockmanship_general',
  'Cuidado de becerras': 'preweaned_calf',
  'Químicos y seguridad': 'safety_other',
  Ordeño: 'none',
  Higiene: 'none',
  'Equipo y mantenimiento': 'none',
  Reproducción: 'none',
  Otro: 'none',
};

/**
 * Cheap FARM-area classification for Q&A events: keyword pass over the text
 * first (catches the narrow job-specific areas), then the topic table, then
 * 'none'.
 */
export function mapToFarmTopic(topic: string, text = ''): FarmTopic {
  const t = normalize(text);
  if (t) {
    for (const rule of KEYWORD_RULES) {
      if (rule.patterns.some((p) => p.test(t))) return rule.farmTopic;
    }
  }
  return TOPIC_TABLE[topic as Topic] ?? 'none';
}
