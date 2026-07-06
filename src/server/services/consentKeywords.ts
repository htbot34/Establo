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

// ── Worker data deletion (BORRAR MIS DATOS) ─────────────────────────────────
// Matching is strict (whole message), like ACEPTO: an irreversible deletion
// must never fire on an incidental phrase inside a longer sentence.

const DELETION_REQUEST_PATTERNS = [
  /^(quiero )?borrar? (todos )?mis datos$/,
  /^(quiero )?eliminar (todos )?mis datos$/,
  /^borrar datos$/,
];

/** "BORRAR MIS DATOS" (and obvious variants) — starts the deletion flow. */
export function isDeletionRequest(text: string): boolean {
  const n = normalize(text);
  return DELETION_REQUEST_PATTERNS.some((p) => p.test(n));
}

/** "SI BORRAR" — confirms a pending deletion request. */
export function isDeletionConfirm(text: string): boolean {
  const n = normalize(text);
  return /^si borrar( mis datos)?$/.test(n);
}

/** How long a deletion request stays confirmable before it quietly expires. */
export const DELETION_CONFIRM_WINDOW_MS = 24 * 3600_000;

/** FARM requires annual signatures; flag at 11 months so renewals happen on time. */
export const RENEWAL_DUE_MONTHS = 11;

export function renewalDue(signedAt: Date, now: Date = new Date()): boolean {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RENEWAL_DUE_MONTHS);
  return signedAt < cutoff;
}
