/**
 * Dashboard i18n: dictionary parity between en and es, the t() lookup
 * fallback chain, and locale-aware on-screen date formatting.
 *
 * The primary completeness guarantee is TYPE-LEVEL: es.ts is declared as
 * `const es: Dictionary` (Dictionary = typeof en), so a missing or extra
 * Spanish key fails `pnpm typecheck`. The runtime shape test below re-checks
 * the same invariant so it also fails loudly if someone ever removes that
 * type annotation.
 */
import { describe, expect, it } from 'vitest';
import { en, type Dictionary } from '../../src/web/i18n/en';
import { es } from '../../src/web/i18n/es';
import { getDictionary, isLocale, t } from '../../src/web/i18n/t';
import { fmtDate, fmtDateTime, timeAgo } from '../../src/web/i18n/dates';

// Type-level assertion (compile error if es drifts from the en key set).
const esTyped: Dictionary = es;
void esTyped;

/** Flatten a dictionary to `path -> leaf kind` for structural comparison. */
function shape(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const [p, kind] of shape(value, path)) out.set(p, kind);
    } else {
      out.set(path, typeof value);
    }
  }
  return out;
}

describe('dictionary completeness (es keys === en keys)', () => {
  it('es has exactly the en key set, with matching leaf kinds', () => {
    const enShape = shape(en);
    const esShape = shape(es);
    const missing = [...enShape.keys()].filter((k) => !esShape.has(k));
    const extra = [...esShape.keys()].filter((k) => !enShape.has(k));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    for (const [path, kind] of enShape) {
      expect(esShape.get(path), path).toBe(kind);
    }
  });

  it('every leaf is a string or a function (nothing else sneaks in)', () => {
    for (const [path, kind] of shape(en)) {
      expect(['string', 'function'], path).toContain(kind);
    }
  });

  it('parameterized entries render with their arguments in both languages', () => {
    expect(en.overview.eventsCount(3)).toBe('3 events');
    expect(es.overview.eventsCount(3)).toBe('3 eventos');
    expect(en.workers.countOf(2, 7)).toBe('2 of 7 workers');
    expect(es.workers.countOf(2, 7)).toBe('2 de 7 trabajadores');
    expect(es.sops.confirmDelete('Rutina de ordeño')).toContain('"Rutina de ordeño"');
  });
});

describe('t() lookup and fallback behavior', () => {
  it('resolves dot-path keys in the requested locale', () => {
    expect(t('en', 'nav.workers')).toBe('Workers');
    expect(t('es', 'nav.workers')).toBe('Trabajadores');
    expect(t('es', 'consent.methods.paper_form')).toBe('formulario en papel');
  });

  it('returns the path itself for an unknown key (visible marker, no crash)', () => {
    expect(t('es', 'nav.doesNotExist')).toBe('nav.doesNotExist');
    expect(t('en', 'totally.made.up')).toBe('totally.made.up');
  });

  it('a path resolving to a non-string (branch or function) falls through to the path', () => {
    expect(t('es', 'nav')).toBe('nav');
    expect(t('es', 'overview.eventsCount')).toBe('overview.eventsCount');
  });

  it('getDictionary falls back to English for anything that is not a known locale', () => {
    expect(getDictionary('es')).toBe(es);
    expect(getDictionary('en')).toBe(en);
    expect(getDictionary('fr')).toBe(en);
    expect(getDictionary(undefined)).toBe(en);
    expect(getDictionary(null)).toBe(en);
    expect(getDictionary('')).toBe(en);
  });

  it('isLocale accepts exactly en/es', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('locale-aware on-screen dates', () => {
  // Mid-month noon UTC so no test-runner timezone can shift the month.
  const iso = '2026-03-15T12:00:00Z';

  it('formats dates per locale', () => {
    expect(fmtDate(iso, 'en')).toMatch(/Mar/);
    expect(fmtDate(iso, 'es').toLowerCase()).toMatch(/mar/);
    expect(fmtDate(null, 'es')).toBe('—');
    expect(fmtDateTime(undefined, 'en')).toBe('—');
  });

  it('timeAgo speaks the selected language', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(timeAgo(null, 'en')).toBe('never');
    expect(timeAgo(null, 'es')).toBe('nunca');
    expect(timeAgo(new Date().toISOString(), 'es')).toBe('ahora mismo');
    expect(timeAgo(fiveMinAgo, 'en')).toBe('5m ago');
    expect(timeAgo(fiveMinAgo, 'es')).toBe('hace 5 min');
    expect(timeAgo(twoHoursAgo, 'es')).toBe('hace 2 h');
    expect(timeAgo(threeDaysAgo, 'es')).toBe('hace 3 d');
  });
});
