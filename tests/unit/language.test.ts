import { describe, expect, it } from 'vitest';
import { looksSpanish } from '../../src/server/services/language.js';

describe('looksSpanish', () => {
  it('treats clear Spanish as Spanish', () => {
    expect(looksSpanish('¿cuánto tiempo dejo el pre-dip?')).toBe(true);
    expect(looksSpanish('¿qué hago si una vaca tiene mastitis?')).toBe(true);
    expect(looksSpanish('necesito ayuda con el ordeño')).toBe(true);
    expect(looksSpanish('no se como se hace el despunte')).toBe(true); // no accents
    expect(looksSpanish('con que se desinfecta el ombligo')).toBe(true);
  });

  it('flags clear, multi-word English as not Spanish', () => {
    expect(looksSpanish('how long do I leave the pre-dip on the teat?')).toBe(false);
    expect(looksSpanish('what do I do if a cow has mastitis?')).toBe(false);
    expect(looksSpanish('can you tell me about colostrum?')).toBe(false);
    expect(looksSpanish('how much colostrum should I give a newborn calf?')).toBe(false);
  });

  it('biases short/ambiguous input to Spanish (never nag a real worker)', () => {
    expect(looksSpanish('mastitis')).toBe(true);
    expect(looksSpanish('pre-dip')).toBe(true);
    expect(looksSpanish('ok')).toBe(true);
    expect(looksSpanish('calostro')).toBe(true);
    expect(looksSpanish('')).toBe(true);
    expect(looksSpanish('   ')).toBe(true);
  });

  it('does not let a stray English-looking token flip real Spanish', () => {
    // "el milking parlor" is Spanglish but mostly Spanish-anchored → Spanish.
    expect(looksSpanish('el milking de la sala')).toBe(true);
  });
});
