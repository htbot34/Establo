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
    // Pay-stem coverage is enumerated by conjugation/phrase on purpose: a bare
    // /\bpag/ would false-match "página" (after accent-stripping → "pagina").
    // Word boundaries also keep "apagar"/"apago" (turn off the pump) clear.
    patterns: [
      /\bsueldos?\b/, /\bsalarios?\b/, /aumento\b/, /\braise\b/, /me pueden? pagar/, /\bpago de horas/,
      /horas extras?\b/, /\bdespid/, /\brenunci/, /\bcontrato\b/, /\bvacaciones\b/, /\bbono\b/,
      /d[i]as de descanso/, /seguro medico/,
      // Pay verbs/nouns: pagan, paga, pago, pagos, pagas, pagar(me/nos/le),
      // págame, paguen(me), pagaron, pagaran, pagará, pagaría — never "pagina".
      /\bpagan\b/, /\bpaga\b/, /\bpagas\b/, /\bpago\b/, /\bpagos\b/, /\bpagame\b/,
      /\bpagar(me|nos|le|les)?\b/, /\bpaguen(me|nos)?\b/, /\bpagaron\b/,
      /\bpagar[ae]n?\b/, /\bpagaria\b/,
      // Paycheck / payday vocabulary. "raya" is rural-Mexican for the pay
      // packet; singular only — plural "rayas" is stripes/lines.
      /\bcheques?\b/, /\bquincenas?\b/, /\braya\b/, /tiempo extra\b/,
      // Earn-verbs, scoped to the pay sense. The trailing \b keeps "¿cuánto
      // ganado hay?" (cattle) clear, and requiring a money/period object keeps
      // "ganó el mundial" style sentences out of the guard.
      /cuanto (me |se |voy a )?gan(o|as?|an|amos)\b/, /\bganar mas\b/,
      /gan(o|as?|an|amos|ar) (mas )?(dinero|por hora|la hora|al dia|por dia|a la semana|por semana|al mes|la quincena)/,
      // "They owe me": require the pagar/dinero object — a bare /me debe/
      // would false-positive on "me debe avisar" etc.
      /me debe(n|s)? (pagar|dinero)/,
    ],
  },
  {
    category: 'immigration',
    topic: 'Otro',
    patterns: [
      /\bvisa\b/, /migraci/, /inmigraci/, /\bpapeles\b/, /\bgreen ?card\b/, /\bcorte de migra/,
      // "la migra" and bare "migra" (the common name for ICE among workers).
      /\bmigra\b/,
      // Deportation conjugations — never "deporte(s)" (sports) or "deportivo".
      /\bdeporta(r|n|ron|ndo|cion|ciones)?\b/, /\bdeporten\b/, /\bdeportad/,
      // ICE the agency. Standalone word only ("hice" never matches); Spanish
      // for the frozen kind is "hielo", so collisions are not realistic here.
      /\bice\b/,
      /\bredadas?\b/, /migratori/, /estatus migratorio/, /permiso de trabajo/,
      /\bilegal(es)?\b/, /indocumentad/,
    ],
  },
  {
    category: 'legal',
    topic: 'Otro',
    patterns: [
      /\babogad/, /\bdemand(a|ar)\b/, /\blegal(es)?\b/, /\bpolicia\b/, /\bmulta\b/,
      /\bdenunci/, /discriminaci/,
      // acoso/acosa/acosan/acosando — the required [oa] keeps "acostada"
      // (a cow lying down) clear via its 't'.
      /\bacos[oa]/,
      // Labor-rights sense of "derechos", scoped by possessive/qualifier so a
      // stray adjective use ("los pezones derechos") can't trip the guard.
      /\b(mis|tus|sus|nuestros) derechos\b/, /tengo derechos\b/,
      /derechos (laborales|humanos|del? trabajador(es)?|como trabajador(es)?)/,
      /\bquejas?\b/, /\bquejar/,
      // Court: only feminine "la corte" (legal). Feed/silage cutting is
      // masculine ("el corte de alfalfa"), so a bare /\bcorte\b/ would
      // false-positive on real dairy phrases and stays out.
      /\bla corte\b/,
    ],
  },
  {
    category: 'medical_dosing',
    topic: 'Salud animal',
    patterns: [
      /\bdosis\b/, /cuant[oa]s? (ml|cc|mililitros|unidades)\b/, /\bpenicilina\b/,
      /\boxitocina\b/, /\bantibiotico/, /\binyecci[oó]n de\b/, /cuanto medicamento/,
      /que medicina le doy/,
      /le inyecto\b/, /cuanta medicina/, /que medicina\b/,
      // vacuna(s)/vacunar — never "vacuno" (cattle, as in "ganado vacuno").
      /\bvacunas?\b/, /\bvacunar/, /\bvacunacion\b/,
      /\bpastillas?\b/,
      // ── English coverage (mixed crews ask in English too) ──
      // dose/dosage — the required 'e' keeps Spanish "dos" (two) clear, and
      // the word boundaries keep English "does" ("how much does it cost")
      // out: d-o-e-s never matches d-o-s-e.
      /\bdoses?\b/, /\bdosages?\b/,
      /\bpenicillin\b/, /\boxytocin\b/, /\bantibiotics?\b/,
      // vaccine/vaccinat(e|ed|ion) — unlike Spanish, where "vacuna" sits one
      // letter from "vacuno" (cattle), no English dairy word shares the
      // double-c "vaccin" stem ("vacuum" has no cc), so the bounded stem is
      // safe.
      /\bvaccines?\b/, /\bvaccinat/,
      // "injection of X" — mirroring /\binyecci[oó]n de\b/: the required "of"
      // keeps status reports ("the injection site is swollen") out.
      /\binjection of\b/,
      // How-much/which-medicine phrasings, mirroring "cuanto medicamento" /
      // "que medicina le doy". Bare "medicine"/"medication" stays out — "the
      // medicine cabinet is locked" is not a dosing question.
      /how much medi(cine|cation)/, /what medi(cine|cation) (do|should) i give/,
      // pill(s) — word boundaries keep "pillars"/"spill" clear.
      /\bpills?\b/,
      // English ml/cc/units amounts, mirroring /cuant[oa]s? (ml|cc|...)/.
      // The required how-many/how-much prefix keeps incidental unit mentions
      // ("record how many liters" has no ml/cc/units) out of the guard.
      /how (many|much) (ml|ccs?|units|milliliters)\b/,
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
