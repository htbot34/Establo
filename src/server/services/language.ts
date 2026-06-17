/**
 * Cheap, deterministic Spanish-vs-other detector — NO LLM call. Used to give a
 * graceful Spanish-only nudge when someone (typically an English-speaking
 * reviewer) types a question in another language, instead of returning the
 * Spanish "no encontré eso" as if it were a knowledge gap.
 *
 * Pure module so the static demo (demoApi.ts) reuses the EXACT same logic the
 * real inbound pipeline uses. Bias is deliberately toward Spanish: short or
 * ambiguous input (a lone "mastitis", "pre-dip", "ok") is treated as Spanish so
 * we never nag a real worker. We only flag clear, multi-word non-Spanish.
 */

function strip(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Spanish function/domain words (accent-stripped). Real Spanish questions are
// dense with these, so a genuine Spanish sentence always out-scores stray
// English-looking tokens.
const ES_WORDS = new Set(
  (
    'el la los las un una unos unas lo le les nos me te se de del al que y o u en con por para ' +
    'segun sin sobre entre hasta desde hacia como cuando donde cuanto cuanta cuantos cuantas ' +
    'cual cuales quien quienes porque mi mis tu tus su sus nuestro nuestra no si ya muy mas ' +
    'menos tambien pero aunque es son esta estan estoy fue ser estar hay tiene tienen tengo ' +
    'hacer hago hace debo debe deben puedo puede pueden quiero quiere necesito dejo deja dejar ' +
    'pongo pone poner uso usar limpio limpiar lavar echa echo aqui alli eso esa ese esto este ' +
    'gracias hola buenos buenas dias vaca vacas leche ordeno becerra becerras becerro pezon ' +
    'pezones ubre toalla cuanto'
  ).split(' '),
);

// Unambiguously-English stopwords/content words. Tokens that collide with
// Spanish ("no", "son", "me", "a", "ha") are deliberately excluded.
const EN_WORDS = new Set(
  (
    'the is are was were what how do does did dont doesnt can could would should will shall may ' +
    'might i you your yours we they he she it with for and of to in on at from about into when ' +
    'where why which who whom whose that this these those much many long time need needs help ' +
    'please thanks thank cow cows milk milking clean cleaning water teat teats calf calves ' +
    'hello hi hey there here have has had get got give take make made use using if then else ' +
    'because an my mine our us am been being'
  ).split(' '),
);

/**
 * True when the text looks like Spanish (or is too short/ambiguous to tell).
 * Only clear multi-word non-Spanish returns false.
 */
export function looksSpanish(text: string): boolean {
  const raw = (text ?? '').trim();
  if (!raw) return true; // empty → never nag

  // Spanish-only orthography is a strong, cheap signal (¿ ¡ ñ á é í ó ú ü).
  if (/[¿¡ñáéíóúü]/i.test(raw)) return true;

  const tokens = strip(raw)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  let es = 0;
  let en = 0;
  for (const t of tokens) {
    if (ES_WORDS.has(t)) es++;
    if (EN_WORDS.has(t)) en++;
  }

  // Clear non-Spanish: at least two English markers and more English than
  // Spanish. Everything else (Spanish, or short/ambiguous) stays Spanish.
  if (en >= 2 && en > es) return false;
  return true;
}
