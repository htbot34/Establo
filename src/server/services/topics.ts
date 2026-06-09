/** Fixed topic taxonomy for training_events — keep in sync with prompts/answer.es.md */
export const TOPIC_TAXONOMY = [
  'Ordeño',
  'Higiene',
  'Cuidado de becerras',
  'Manejo de animales',
  'Químicos y seguridad',
  'Equipo y mantenimiento',
  'Salud animal',
  'Reproducción',
  'Otro',
] as const;

export type Topic = (typeof TOPIC_TAXONOMY)[number];

export function isValidTopic(t: string): t is Topic {
  return (TOPIC_TAXONOMY as readonly string[]).includes(t);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const KEYWORD_RULES: Array<{ topic: Topic; patterns: RegExp[] }> = [
  {
    topic: 'Químicos y seguridad',
    patterns: [
      /quimic/, /cloro/, /acido/, /diluci/, /dilui/, /detergente desinfectante/, /\bepp\b/,
      /guantes/, /gogles|lentes de seguridad/, /mezclar/, /derrame/, /candadeo|bloqueo/,
      /seguridad/,
    ],
  },
  {
    topic: 'Cuidado de becerras',
    patterns: [/becerr/, /ternero|ternera/, /calostro/, /ombligo/, /recien nacid/, /destete/],
  },
  {
    topic: 'Ordeño',
    patterns: [
      /\borden/, /predip|pre-dip|pre dip/, /postdip|post-dip|post dip/, /pezon/, /pezoner/,
      /despunte/, /sellador/, /fomento/, /\bubre\b/,
    ],
  },
  {
    topic: 'Higiene',
    patterns: [/limpiez/, /lavad/, /\bcip\b/, /sanitiz/, /desinfecci/, /higien/, /enjuag/],
  },
  {
    topic: 'Manejo de animales',
    patterns: [
      /zona de fuga/, /arrear|arreo/, /mover (las )?vacas/, /chicharra|picana/, /bajo estres/,
      /punto de balance/, /manejo de animales/,
    ],
  },
  {
    topic: 'Salud animal',
    patterns: [/mastitis/, /cojera|coja/, /enferm/, /fiebre/, /tratamiento/, /vacun/, /medicament/],
  },
  {
    topic: 'Equipo y mantenimiento',
    patterns: [/equipo/, /bomba/, /motor/, /mantenimiento/, /pulsador/, /vacio/, /manguera/],
  },
  {
    topic: 'Reproducción',
    patterns: [/inseminac/, /\bcelo\b/, /pren(ez|ada)/, /reproducc/, /parto/, /seca(s| )/],
  },
];

/**
 * Keyword fallback classifier — used when no LLM key is configured (the real
 * pipeline gets the topic from Claude's <meta> tag in the same call).
 */
export function classifyTopicByKeywords(text: string): Topic {
  const t = normalize(text);
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.topic;
  }
  return 'Otro';
}
