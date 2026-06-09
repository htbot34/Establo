import type { Topic } from './topics.js';

/**
 * Hard guard for topics Establo must NEVER advise on, regardless of what the
 * LLM or retrieval would do: veterinary medical dosing, legal advice, and
 * employment/immigration matters. Refuse warmly in Spanish and escalate.
 * This runs BEFORE retrieval/LLM, in both real and stub modes.
 */

export type ForbiddenCategory = 'employment' | 'immigration' | 'legal' | 'medical_dosing';

interface ForbiddenMatch {
  category: ForbiddenCategory;
  topic: Topic;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const RULES: Array<{ category: ForbiddenCategory; topic: Topic; patterns: RegExp[] }> = [
  {
    category: 'employment',
    topic: 'Otro',
    patterns: [
      /\bsueldo\b/, /\bsalario\b/, /aumento\b/, /\braise\b/, /me pueden? pagar/, /\bpago de horas/,
      /horas extras?\b/, /\bdespid/, /\brenunci/, /\bcontrato\b/, /\bvacaciones\b/, /\bbono\b/,
      /d[i]as de descanso/, /seguro medico/,
    ],
  },
  {
    category: 'immigration',
    topic: 'Otro',
    patterns: [/\bvisa\b/, /migraci/, /inmigraci/, /\bpapeles\b/, /\bgreen ?card\b/, /\bcorte de migra/],
  },
  {
    category: 'legal',
    topic: 'Otro',
    patterns: [/\babogad/, /\bdemand(a|ar)\b/, /\blegal(es)?\b/, /\bpolicia\b/, /\bmulta\b/],
  },
  {
    category: 'medical_dosing',
    topic: 'Salud animal',
    patterns: [
      /\bdosis\b/, /cuant[oa]s? (ml|cc|mililitros|unidades) de/, /\bpenicilina\b/,
      /\boxitocina\b/, /\bantibiotico/, /\binyecci[oó]n de\b/, /cuanto medicamento/,
      /que medicina le doy/,
    ],
  },
];

export function matchForbiddenTopic(text: string): ForbiddenMatch | null {
  const t = normalize(text);
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) {
      return { category: rule.category, topic: rule.topic };
    }
  }
  return null;
}
