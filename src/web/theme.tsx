import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useT } from './i18n/context';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'establo-theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Explicit localStorage choice wins; otherwise follow prefers-color-scheme. */
export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode / blocked storage */
  }
  return systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const t = useT();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Track the system preference while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      let explicit = false;
      try {
        explicit = !!localStorage.getItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (!explicit) setTheme(systemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const nextLabel =
    theme === 'dark' ? t.themeToggle.switchToLight : t.themeToggle.switchToDark;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={nextLabel}
      title={nextLabel}
      className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === 'dark' ? (
        <Moon className="size-4" aria-hidden="true" />
      ) : (
        <Sun className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
