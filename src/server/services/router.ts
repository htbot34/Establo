/**
 * Inbound message router — pure functions, heavily unit-tested.
 * Decides whether a worker message is a comprehension-check answer, a
 * greeting, an explicit help request, an "OK" acknowledgement, or (the
 * default) an SOP question.
 */

export type RouteKind = 'check_answer' | 'greeting' | 'help' | 'ok_ack' | 'question' | 'empty';

export interface RouteInput {
  text: string;
  /** Options of the worker's pending comprehension check, if any. */
  pendingCheckOptions?: string[] | null;
}

export interface RouteResult {
  kind: RouteKind;
  checkIndex?: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡!?.,;:()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ORDINAL_WORDS: Array<{ index: number; patterns: RegExp[] }> = [
  { index: 0, patterns: [/^(el |la )?(uno|primera?o?)$/, /^(opcion|numero|respuesta) (uno|1)$/] },
  { index: 1, patterns: [/^(el |la )?(dos|segunda?o?)$/, /^(opcion|numero|respuesta) (dos|2)$/] },
  { index: 2, patterns: [/^(el |la )?(tres|tercera?o?)$/, /^(opcion|numero|respuesta) (tres|3)$/] },
];

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((w) => w.length > 2));
}

/**
 * Match a worker reply against the check options. Accepts "1"/"2"/"3",
 * ordinal words ("la segunda"), or a fuzzy match of the option text itself —
 * voice answers arrive as free-form transcripts ("treinta segundos creo").
 */
export function parseCheckAnswer(text: string, options: string[]): number | null {
  const n = normalize(text);
  if (!n) return null;

  const digit = /^(?:la |el |opcion |numero |respuesta )*([123])\b/.exec(n);
  if (digit) {
    const idx = Number(digit[1]) - 1;
    return idx < options.length ? idx : null;
  }

  for (const { index, patterns } of ORDINAL_WORDS) {
    if (index < options.length && patterns.some((p) => p.test(n))) return index;
  }

  // Fuzzy: token overlap with each option (voice transcripts).
  const answerTokens = tokenSet(text);
  if (answerTokens.size === 0) return null;
  let bestIdx: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < options.length; i++) {
    const optTokens = tokenSet(options[i]);
    if (optTokens.size === 0) continue;
    let overlap = 0;
    for (const t of optTokens) if (answerTokens.has(t)) overlap++;
    const score = overlap / optTokens.size;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    } else if (score === bestScore && score > 0) {
      bestIdx = null; // ambiguous tie
    }
  }
  return bestScore >= 0.6 ? bestIdx : null;
}

const GREETINGS = [
  /^hola+\b/, /^buenos dias\b/, /^buenas tardes\b/, /^buenas noches\b/, /^buenas\b/,
  /^que tal\b/, /^hey\b/, /^buen dia\b/, /^saludos\b/, /^hello\b/, /^hi\b/,
];

const OK_ACKS = [
  /^ok(ey|ay)?$/, /^si$/, /^sii+$/, /^listo$/, /^va$/, /^dale$/, /^claro( que si)?$/,
  /^esta bien$/, /^de acuerdo$/, /^gracias$/, /^muchas gracias$/, /^👍$/, /^andale$/,
];

const HELP_REQUESTS = [
  /^ayuda$/, /^help$/, /^necesito ayuda$/, /^no entiendo$/, /^no entendi$/,
  /^quiero hablar con (el |mi )?supervisor$/, /^con quien puedo hablar$/, /^supervisor$/,
];

export function routeInbound(input: RouteInput): RouteResult {
  const raw = input.text ?? '';
  const n = normalize(raw);
  if (!n) return { kind: 'empty' };

  if (input.pendingCheckOptions && input.pendingCheckOptions.length > 0) {
    const idx = parseCheckAnswer(raw, input.pendingCheckOptions);
    if (idx !== null) return { kind: 'check_answer', checkIndex: idx };
  }

  if (OK_ACKS.some((p) => p.test(n))) return { kind: 'ok_ack' };

  const words = n.split(' ').length;
  if (words <= 4 && GREETINGS.some((p) => p.test(n))) return { kind: 'greeting' };

  if (HELP_REQUESTS.some((p) => p.test(n))) return { kind: 'help' };

  return { kind: 'question' };
}
