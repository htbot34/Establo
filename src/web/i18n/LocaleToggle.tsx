import { useLocale, useT } from './context';
import { LOCALES, type Locale } from './t';

/**
 * Compact EN/ES segmented switch for the dashboard chrome, styled to sit next
 * to the ThemeToggle. Optimistic: the UI flips immediately; persistence (or
 * demo local-state fallback) is the LocaleProvider's job.
 */
export function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const languageName: Record<Locale, string> = {
    en: t.localeToggle.english,
    es: t.localeToggle.spanish,
  };
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-md border border-border text-xs font-semibold">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          aria-label={t.localeToggle.switchTo(languageName[l])}
          title={t.localeToggle.switchTo(languageName[l])}
          className={`h-full px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            locale === l
              ? 'bg-navactive-bg text-navactive-fg'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
