import { describe, expect, it } from 'vitest';
import { ES } from '../../src/server/services/messages.es.js';

/**
 * The first-contact disclosure is worker-facing, compliance-adjacent copy:
 * every sentence is a promise the code has to keep (employer visibility,
 * voice transcription, restricted-topic redaction, retention, the deletion
 * right, legal-disclosure posture, BAJA). Pin the exact text so any future
 * edit is deliberate and reviewed — not an incidental casualty of a refactor.
 */
describe('ES.disclosure', () => {
  it('is pinned word-for-word', () => {
    expect(ES.disclosure('Rancho Vista')).toBe(
      'Hola 👋 Soy Establo, el ayudante de capacitación de Rancho Vista. ' +
        'Tus preguntas y respuestas aquí se guardan como registros de capacitación que tu empleador puede ver. ' +
        'Las notas de voz se convierten a texto. ' +
        'No puedo hablar de sueldo, temas legales ni de migración — esos temas van con tu supervisor. ' +
        'Si preguntas algo legal o de migración, tus palabras exactas no quedan en el registro. ' +
        'Los mensajes se borran a los 180 días, y puedes borrar todos tus datos cuando quieras: escribe BORRAR MIS DATOS. ' +
        'Tus datos solo salen de la lechería si la ley lo obliga. ' +
        'Si ya no quieres recibir mensajes, escribe BAJA. ' +
        '¿Más dudas? Pregunta a tu supervisor por la política de datos.',
    );
  });

  it('reflects a configured retention window', () => {
    expect(ES.disclosure('X', 90)).toContain('se borran a los 90 días');
  });

  it('never claims verbatim forwarding of restricted topics', () => {
    // The pre-redaction wording implied restricted questions were passed
    // along ("eso es con tu supervisor" right after the visibility sentence,
    // with nothing about words being withheld). The claim that exact words
    // stay out of the record is limited to legal/migración — the two
    // categories the code actually redacts.
    const text = ES.disclosure('X');
    expect(text).toContain('tus palabras exactas no quedan en el registro');
    expect(text).toContain('legal o de migración');
  });
});
