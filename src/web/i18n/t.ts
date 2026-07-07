/**
 * Pure locale plumbing (no React) — unit-testable from node, mirroring how
 * other browser-safe pure modules in this repo are kept import-light.
 */
import { en, type Dictionary } from './en';
import { es } from './es';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Dictionary for a locale. Anything that is not a known locale — an absent
 * user preference, a stale value from an old fixture, a future locale this
 * build doesn't know — falls back to English, which is the pre-i18n behavior.
 */
export function getDictionary(locale: unknown): Dictionary {
  return locale === 'es' ? es : en;
}

function resolvePath(dict: Dictionary, path: string): unknown {
  let node: unknown = dict;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Dot-path string lookup for the rare dynamic key (badge labels keyed by a
 * server enum). Typed pages should prefer `useT().section.key` — the compiler
 * already guarantees es/en parity there. Fallback order: requested locale →
 * English → the path itself (a visible marker, never a crash).
 */
export function t(locale: Locale, path: string): string {
  const hit = resolvePath(getDictionary(locale), path);
  if (typeof hit === 'string') return hit;
  const fallback = resolvePath(en, path);
  if (typeof fallback === 'string') return fallback;
  return path;
}

export type { Dictionary };
