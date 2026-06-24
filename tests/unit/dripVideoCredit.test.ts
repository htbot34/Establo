import { describe, expect, it } from 'vitest';
import { composeModuleMessage, ttsVariant } from '../../src/server/services/drip.js';
import type { Module } from '../../src/server/db/schema.js';

const ATTR =
  '«Considering Human and Animal Safety» — producido bajo la dirección del Dr. Robert Hagevoort. Usado con autorización.';
const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';

function makeModule(overrides: Partial<Module>): Module {
  return {
    id: 'm1',
    trackId: 't1',
    orgId: 'o1',
    orderIndex: 0,
    dayOffset: 0,
    sendHourLocal: 7,
    farmTopic: 'stockmanship_general',
    appliesToRoles: [],
    videoUrl: null,
    videoTitleEs: null,
    videoProvider: null,
    videoLangs: null,
    videoAttribution: null,
    title: 'Lección de prueba',
    bodyEs: 'Cuerpo de la lección.',
    checkQuestionEs: '¿Listo?',
    checkOptionsEs: ['Sí', 'No', 'Tal vez'],
    checkCorrectIndex: 0,
    sourceDocumentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Module;
}

describe('composeModuleMessage — video credit line', () => {
  it('emits the credit line right after the video line when attribution is set', () => {
    const text = composeModuleMessage(
      makeModule({ videoUrl: VIDEO_URL, videoTitleEs: 'Mi video', videoAttribution: ATTR }),
      3,
      8,
    );
    expect(text).toContain(`📹 Mira el video (Mi video): ${VIDEO_URL}`);
    expect(text).toContain(`ℹ️ Crédito del video: ${ATTR}`);
    // Body → video line → credit line ordering.
    expect(text.indexOf('Cuerpo de la lección.')).toBeLessThan(text.indexOf('📹'));
    expect(text.indexOf('📹')).toBeLessThan(text.indexOf('Crédito del video:'));
  });

  it('omits the credit line when a video has no attribution', () => {
    const text = composeModuleMessage(
      makeModule({ videoUrl: VIDEO_URL, videoTitleEs: 'Mi video', videoAttribution: null }),
      3,
      8,
    );
    expect(text).toContain('📹 Mira el video');
    expect(text).not.toContain('Crédito del video:');
  });

  it('omits both lines when there is no video (attribution alone is inert)', () => {
    const text = composeModuleMessage(makeModule({ videoAttribution: ATTR }), 0, 1);
    expect(text).not.toContain('📹');
    expect(text).not.toContain('Crédito del video:');
  });
});

describe('ttsVariant — strips the URL and the credit', () => {
  it('drops the video URL and the whole credit line, keeps a spoken video mention', () => {
    const text = composeModuleMessage(
      makeModule({ videoUrl: VIDEO_URL, videoTitleEs: 'Mi video', videoAttribution: ATTR }),
      3,
      8,
    );
    const tts = ttsVariant(text);
    expect(tts).not.toContain(VIDEO_URL);
    expect(tts).not.toContain('Crédito del video:');
    expect(tts).not.toContain(ATTR);
    expect(tts).not.toContain('ℹ️');
    expect(tts).not.toContain('📹');
    // The lesson still tells the worker a video was sent.
    expect(tts).toContain('Te mandé también un video');
  });
});
