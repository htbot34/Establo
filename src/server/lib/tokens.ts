/**
 * Cheap token estimate (≈4 chars/token holds reasonably for Spanish too).
 * Used only for chunk sizing — does not need to be exact.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
