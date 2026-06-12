/**
 * Pure consent-keyword parsing (no DB imports) so the in-browser static demo
 * can reuse the EXACT matching the real pipeline uses. DB transitions live in
 * consent.ts, which re-exports these.
 */

export type ConsentKeyword = 'alta' | 'baja';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡!?.,;:()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const OPT_OUT_PATTERNS = [
  /^baja$/,
  /^stop$/,
  /^alto$/,
  /^no mas mensajes$/,
  /^no quiero mas mensajes$/,
  /^ya no me manden mensajes$/,
  /^unsubscribe$/,
  /^cancelar$/,
];

const OPT_IN_PATTERNS = [/^alta$/];

/** Detect ALTA / BAJA (and obvious opt-out variants). */
export function parseConsentKeyword(text: string): ConsentKeyword | null {
  const n = normalize(text);
  if (!n) return null;
  if (OPT_OUT_PATTERNS.some((p) => p.test(n))) return 'baja';
  if (OPT_IN_PATTERNS.some((p) => p.test(n))) return 'alta';
  return null;
}

/** ACEPTO reply for the cow care agreement. */
export function isAceptoReply(text: string): boolean {
  const n = normalize(text);
  return /^(si )?(lo )?acepto$/.test(n) || n === 'acepto el acuerdo';
}

/** FARM requires annual signatures; flag at 11 months so renewals happen on time. */
export const RENEWAL_DUE_MONTHS = 11;

export function renewalDue(signedAt: Date, now: Date = new Date()): boolean {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RENEWAL_DUE_MONTHS);
  return signedAt < cutoff;
}
