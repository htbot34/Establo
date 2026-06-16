import { describe, expect, it } from 'vitest';
import { parseCheckAnswer, routeInbound } from '../../src/server/services/router.js';
import { matchForbiddenTopic } from '../../src/server/services/guards.js';

const OPTIONS = ['5 segundos', '30 segundos', '5 minutos'];

describe('parseCheckAnswer', () => {
  it('accepts bare digits', () => {
    expect(parseCheckAnswer('1', OPTIONS)).toBe(0);
    expect(parseCheckAnswer('2', OPTIONS)).toBe(1);
    expect(parseCheckAnswer('3.', OPTIONS)).toBe(2);
    expect(parseCheckAnswer(' 2)', OPTIONS)).toBe(1);
  });

  it('accepts ordinal words and "opcion N" phrasing', () => {
    expect(parseCheckAnswer('la segunda', OPTIONS)).toBe(1);
    expect(parseCheckAnswer('la primera', OPTIONS)).toBe(0);
    expect(parseCheckAnswer('opcion 3', OPTIONS)).toBe(2);
    expect(parseCheckAnswer('el dos', OPTIONS)).toBe(1);
  });

  it('fuzzy-matches voice transcripts against option text', () => {
    expect(parseCheckAnswer('creo que son treinta segundos', ['5 segundos', 'treinta segundos', '5 minutos'])).toBe(1);
    expect(parseCheckAnswer('en el hombro', ['En el hombro', 'En la cola', 'En las orejas'])).toBe(0);
  });

  it('returns null for unrelated text and ambiguous answers', () => {
    expect(parseCheckAnswer('¿cuánto dura el post-dip?', OPTIONS)).toBeNull();
    expect(parseCheckAnswer('no sé', OPTIONS)).toBeNull();
    expect(parseCheckAnswer('', OPTIONS)).toBeNull();
  });

  it('rejects digits beyond the option count', () => {
    expect(parseCheckAnswer('3', ['sí', 'no'])).toBeNull();
  });
});

describe('routeInbound', () => {
  it('classifies check answers first when a check is pending', () => {
    expect(routeInbound({ text: '2', pendingCheckOptions: OPTIONS })).toEqual({
      kind: 'check_answer',
      checkIndex: 1,
    });
    // "hola" is not an answer — falls through to greeting even with a pending check
    expect(routeInbound({ text: 'hola', pendingCheckOptions: OPTIONS }).kind).toBe('greeting');
  });

  it('classifies greetings (short only)', () => {
    expect(routeInbound({ text: 'Hola' }).kind).toBe('greeting');
    expect(routeInbound({ text: 'buenos días' }).kind).toBe('greeting');
    expect(routeInbound({ text: 'hola, ¿cuánto tiempo dejo el pre-dip en el pezón?' }).kind).toBe(
      'question',
    );
  });

  it('classifies OK acknowledgements', () => {
    expect(routeInbound({ text: 'OK' }).kind).toBe('ok_ack');
    expect(routeInbound({ text: 'listo' }).kind).toBe('ok_ack');
    expect(routeInbound({ text: 'gracias' }).kind).toBe('ok_ack');
  });

  it('classifies explicit help requests', () => {
    expect(routeInbound({ text: 'ayuda' }).kind).toBe('help');
    expect(routeInbound({ text: 'quiero hablar con mi supervisor' }).kind).toBe('help');
  });

  it('defaults to question', () => {
    expect(routeInbound({ text: '¿qué hago si la vaca cojea?' }).kind).toBe('question');
    expect(routeInbound({ text: 'se descompuso la bomba ayuda con eso' }).kind).toBe('question');
  });

  it('flags empty input', () => {
    expect(routeInbound({ text: '   ' }).kind).toBe('empty');
  });
});

describe('matchForbiddenTopic (hard guard)', () => {
  it('catches salary / employment topics', () => {
    expect(matchForbiddenTopic('¿me puedes subir el sueldo?')?.category).toBe('employment');
    expect(matchForbiddenTopic('cuándo me pagan las horas extras')?.category).toBe('employment');
  });
  it('catches immigration and legal topics', () => {
    expect(matchForbiddenTopic('necesito arreglar mis papeles')?.category).toBe('immigration');
    expect(matchForbiddenTopic('puedo demandar si me corren')?.category).toBeDefined();
  });
  it('catches veterinary dosing', () => {
    expect(matchForbiddenTopic('¿cuál es la dosis de penicilina?')?.category).toBe('medical_dosing');
  });
  it('catches bare pay-stem questions (pagan/paga/pago/pagar/págame)', () => {
    expect(matchForbiddenTopic('¿cuánto pagan aquí?')?.category).toBe('employment');
    expect(matchForbiddenTopic('no me pagan bien')?.category).toBe('employment');
    expect(matchForbiddenTopic('¿cuándo pagan?')?.category).toBe('employment');
    expect(matchForbiddenTopic('¿cuánto pagas la hora?')?.category).toBe('employment');
    expect(matchForbiddenTopic('quiero que me paguen lo de la semana')?.category).toBe('employment');
    expect(matchForbiddenTopic('págame lo que me deben')?.category).toBe('employment');
    expect(matchForbiddenTopic('todavía no me pagaron')?.category).toBe('employment');
    expect(matchForbiddenTopic('¿cuándo es el pago?')?.category).toBe('employment');
  });
  it('does not false-match "página" or "apagar" on the pay stem', () => {
    expect(matchForbiddenTopic('mira la página 3 del manual')).toBeNull();
    expect(matchForbiddenTopic('¿en qué página está la rutina de ordeño?')).toBeNull();
    expect(matchForbiddenTopic('¿cómo apago la bomba de vacío?')).toBeNull();
    expect(matchForbiddenTopic('apaga la luz de la sala')).toBeNull();
  });
  it('lets normal SOP questions through', () => {
    expect(matchForbiddenTopic('¿cuánto tiempo dejo el pre-dip?')).toBeNull();
    expect(matchForbiddenTopic('¿cómo muevo las vacas a la sala?')).toBeNull();
  });
});
