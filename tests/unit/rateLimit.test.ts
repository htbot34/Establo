import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimits } from '../../src/server/services/rateLimit.js';

describe('inbound rate limit (20 msgs / 5 min per worker)', () => {
  beforeEach(() => resetRateLimits());

  it('allows up to the limit, then blocks with a single warning', () => {
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit('w1', t0 + i * 1000).allowed).toBe(true);
    }
    const blocked = checkRateLimit('w1', t0 + 21_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.shouldWarn).toBe(true);
    // Subsequent violations in the same window do NOT re-warn (no spam).
    const again = checkRateLimit('w1', t0 + 22_000);
    expect(again.allowed).toBe(false);
    expect(again.shouldWarn).toBe(false);
  });

  it('frees up as the window slides', () => {
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) checkRateLimit('w2', t0 + i);
    expect(checkRateLimit('w2', t0 + 1000).allowed).toBe(false);
    expect(checkRateLimit('w2', t0 + 5 * 60_000 + 1000).allowed).toBe(true);
  });

  it('tracks workers independently', () => {
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) checkRateLimit('w3', t0 + i);
    expect(checkRateLimit('w3', t0 + 100).allowed).toBe(false);
    expect(checkRateLimit('w4', t0 + 100).allowed).toBe(true);
  });
});
