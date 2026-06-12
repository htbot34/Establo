import { describe, expect, it } from 'vitest';
import { isAceptoReply, parseConsentKeyword } from '../../src/server/services/consent.js';

describe('consent keywords (ALTA / BAJA / variants)', () => {
  it('detects ALTA in any casing/punctuation', () => {
    expect(parseConsentKeyword('ALTA')).toBe('alta');
    expect(parseConsentKeyword('alta')).toBe('alta');
    expect(parseConsentKeyword(' Alta! ')).toBe('alta');
  });

  it('detects BAJA and the obvious opt-out variants', () => {
    expect(parseConsentKeyword('BAJA')).toBe('baja');
    expect(parseConsentKeyword('baja')).toBe('baja');
    expect(parseConsentKeyword('stop')).toBe('baja');
    expect(parseConsentKeyword('STOP')).toBe('baja');
    expect(parseConsentKeyword('alto')).toBe('baja');
    expect(parseConsentKeyword('no más mensajes')).toBe('baja');
    expect(parseConsentKeyword('no mas mensajes')).toBe('baja');
    expect(parseConsentKeyword('ya no me manden mensajes')).toBe('baja');
  });

  it('does NOT fire on normal messages that merely contain the words', () => {
    expect(parseConsentKeyword('la presión está muy alta')).toBeNull();
    expect(parseConsentKeyword('¿la dosis de cloro es alta o baja?')).toBeNull();
    expect(parseConsentKeyword('el tanque está alto')).toBeNull();
    expect(parseConsentKeyword('hola')).toBeNull();
    expect(parseConsentKeyword('')).toBeNull();
  });

  it('detects ACEPTO replies for agreement signatures', () => {
    expect(isAceptoReply('ACEPTO')).toBe(true);
    expect(isAceptoReply('acepto')).toBe(true);
    expect(isAceptoReply('sí acepto')).toBe(true);
    expect(isAceptoReply('Lo acepto')).toBe(true);
    expect(isAceptoReply('acepto el acuerdo')).toBe(true);
    expect(isAceptoReply('no acepto')).toBe(false);
    expect(isAceptoReply('aceptó la vaca el alimento?')).toBe(false);
    expect(isAceptoReply('ok')).toBe(false);
  });
});
