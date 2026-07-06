import { describe, expect, it } from 'vitest';
import { shouldSendAudio } from '../../src/server/services/drip.js';

/**
 * The reply-audio decision for question answers (inbound.ts) and
 * comprehension-check feedback (drip.ts): TTS goes out when the worker sent a
 * voice note OR their always-audio toggle is on. All four combinations are
 * pinned so neither call site can silently regress to voice-notes-only.
 * Module deliveries are not covered here on purpose — they always attach
 * audio, independent of this policy.
 */
describe('shouldSendAudio — wasVoice × alwaysAudio', () => {
  it.each([
    // [wasVoice, alwaysAudio, expected]
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('wasVoice=%s, alwaysAudio=%s → %s', (wasVoice, alwaysAudio, expected) => {
    expect(shouldSendAudio(wasVoice, alwaysAudio)).toBe(expected);
  });
});
