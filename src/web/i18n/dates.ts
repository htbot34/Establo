/**
 * Locale-aware date formatting for ON-SCREEN dates only. The PDFs (audit
 * pack, transcripts, certificates) format their own dates server-side and are
 * deliberately untouched — they stay English for FARM evaluators.
 */
import { getDictionary, type Locale } from './t';

// es-MX as the Intl locale for Latin American Spanish month/day names.
const INTL: Record<Locale, string> = { en: 'en-US', es: 'es-MX' };

export function fmtDateTime(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(INTL[locale], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string | null | undefined, locale: Locale = 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(INTL[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function timeAgo(iso: string | null | undefined, locale: Locale = 'en'): string {
  const d = getDictionary(locale).dates;
  if (!iso) return d.never;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return d.justNow;
  if (s < 3600) return d.minutesAgo(Math.floor(s / 60));
  if (s < 86400) return d.hoursAgo(Math.floor(s / 3600));
  return d.daysAgo(Math.floor(s / 86400));
}
