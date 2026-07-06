/**
 * Per-worker inbound rate limit: 20 messages / 5 minutes (in-memory sliding
 * window — single-process MVP; documented in DECISIONS.md).
 */
const WINDOW_MS = 5 * 60 * 1000;
const LIMIT = 20;

interface Entry {
  timestamps: number[];
  warnedAt: number | null;
}

const buckets = new Map<string, Entry>();

export interface RateLimitResult {
  allowed: boolean;
  /** true exactly once per violation window — send the polite slow-down then. */
  shouldWarn: boolean;
}

export function checkRateLimit(
  workerId: string,
  now: number = Date.now(),
  limit: number = LIMIT,
  windowMs: number = WINDOW_MS,
): RateLimitResult {
  let entry = buckets.get(workerId);
  if (!entry) {
    entry = { timestamps: [], warnedAt: null };
    buckets.set(workerId, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= limit) {
    const shouldWarn = !entry.warnedAt || now - entry.warnedAt >= windowMs;
    if (shouldWarn) entry.warnedAt = now;
    return { allowed: false, shouldWarn };
  }
  entry.timestamps.push(now);
  return { allowed: true, shouldWarn: false };
}

export function resetRateLimits(): void {
  buckets.clear();
  authFailures.clear();
}

// ── Auth endpoint throttling (login + setup) ────────────────────────────────
// Counts FAILED attempts per key (e.g. `login:<ip>`), fail2ban-style, so an
// attacker gets cut off while legitimate successful logins never accumulate.
// In-memory, same single-process assumption as the worker rate limiter above.

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 10;

const authFailures = new Map<string, number[]>();

export function recordAuthFailure(key: string, now: number = Date.now()): void {
  const list = (authFailures.get(key) ?? []).filter((t) => now - t < AUTH_WINDOW_MS);
  list.push(now);
  authFailures.set(key, list);
}

/** true once a key has accumulated 10 failures inside the 15-minute window. */
export function isAuthThrottled(key: string, now: number = Date.now()): boolean {
  const list = authFailures.get(key);
  if (!list) return false;
  const fresh = list.filter((t) => now - t < AUTH_WINDOW_MS);
  authFailures.set(key, fresh);
  return fresh.length >= AUTH_FAILURE_LIMIT;
}
