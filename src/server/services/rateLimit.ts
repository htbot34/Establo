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
}
