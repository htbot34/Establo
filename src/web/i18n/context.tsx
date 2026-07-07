import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, IS_DEMO } from '../api';
import { useAuth } from '../auth';
import { fmtDate, fmtDateTime, timeAgo } from './dates';
import { getDictionary, isLocale, type Dictionary, type Locale } from './t';

interface LocaleState {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

// Exported (not just the hook) so tests can render a page at a fixed locale
// without standing up auth.
export const LocaleContext = createContext<LocaleState>({ locale: 'en', setLocale: () => {} });

/**
 * Current locale = the signed-in user's saved uiLocale, unless they flipped
 * the switch this session (the override wins immediately — optimistic UI).
 * The flip is persisted via PATCH /api/auth/me; in the static demo there is
 * no backend, so the override IS the whole mechanism (resets on reload).
 * Signed out (login page) there is no user preference → English.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [override, setOverride] = useState<Locale | null>(null);
  const serverLocale: Locale = isLocale(me?.user.uiLocale) ? me!.user.uiLocale : 'en';
  const locale = override ?? serverLocale;

  const setLocale = useCallback(
    (next: Locale) => {
      const previous = override ?? serverLocale;
      if (next === previous) return;
      setOverride(next);
      if (IS_DEMO || !me) return; // session-local only: nothing to persist to
      void api('/api/auth/me', { method: 'PATCH', body: { uiLocale: next } }).catch(() => {
        setOverride(previous);
        toast.error(getDictionary(previous).localeToggle.saveFailed);
      });
    },
    [override, serverLocale, me],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  return useContext(LocaleContext);
}

/** The typed dictionary for the current locale: `const t = useT(); t.nav.workers`. */
export function useT(): Dictionary {
  return getDictionary(useLocale().locale);
}

/** Locale-bound on-screen date formatters (PDF dates are server-side, unchanged). */
export function useFmt() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      fmtDate: (iso: string | null | undefined) => fmtDate(iso, locale),
      fmtDateTime: (iso: string | null | undefined) => fmtDateTime(iso, locale),
      timeAgo: (iso: string | null | undefined) => timeAgo(iso, locale),
    }),
    [locale],
  );
}
