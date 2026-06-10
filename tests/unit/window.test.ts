import { describe, expect, it } from 'vitest';
import { WINDOW_MS, windowState } from '../../src/server/services/window.js';

describe('windowState (WhatsApp 24h customer-service window)', () => {
  const now = new Date('2026-06-10T12:00:00Z');

  it('is closed when the worker has never written', () => {
    expect(windowState(null, now)).toBe('closed');
    expect(windowState(undefined, now)).toBe('closed');
  });

  it('is open just after an inbound message', () => {
    expect(windowState(new Date(now.getTime() - 1000), now)).toBe('open');
  });

  it('is open at 23h59m', () => {
    expect(windowState(new Date(now.getTime() - (WINDOW_MS - 60_000)), now)).toBe('open');
  });

  it('closes at exactly 24h', () => {
    expect(windowState(new Date(now.getTime() - WINDOW_MS), now)).toBe('closed');
  });

  it('is closed well past 24h', () => {
    expect(windowState(new Date(now.getTime() - 30 * 3600_000), now)).toBe('closed');
  });

  it('treats future timestamps (clock skew) as closed', () => {
    expect(windowState(new Date(now.getTime() + 60_000), now)).toBe('closed');
  });
});
