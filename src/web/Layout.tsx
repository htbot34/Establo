import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Users,
  GraduationCap,
  MessagesSquare,
  FolderArchive,
  Settings as SettingsIcon,
  Smartphone,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { api, IS_DEMO } from './api';
import { useAuth } from './auth';
import { Spinner } from './components';
import { Logomark } from './brand/Logomark';
import { LocaleToggle, useFmt, useT, type Dictionary } from './i18n';
import { ThemeToggle } from './theme';

interface NavItem {
  to: string;
  label: (t: Dictionary) => string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: (t) => t.nav.overview, icon: LayoutDashboard, end: true },
  { to: '/sops', label: (t) => t.nav.sops, icon: FileText },
  { to: '/workers', label: (t) => t.nav.workers, icon: Users },
  { to: '/onboarding', label: (t) => t.nav.onboarding, icon: GraduationCap },
  { to: '/conversations', label: (t) => t.nav.conversations, icon: MessagesSquare },
  { to: '/audit', label: (t) => t.nav.audit, icon: FolderArchive },
  { to: '/settings', label: (t) => t.nav.settings, icon: SettingsIcon },
];

interface Alerts {
  templatePausedAt: string | null;
  templatePauseReason: string | null;
}

/**
 * Red banner when WhatsApp template delivery failed for a category-policy
 * reason: drip sends are paused org-wide until an owner acknowledges.
 */
function TemplateAlertBanner({ role }: { role: string }) {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const { fmtDateTime } = useFmt();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const a = await api<Alerts>('/api/alerts');
        if (!cancelled) setAlerts(a);
      } catch {
        /* session expired etc. — banner just stays hidden */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!alerts?.templatePausedAt) return null;

  async function acknowledge() {
    setBusy(true);
    try {
      await api('/api/alerts/templates/acknowledge', { method: 'POST', body: {} });
      setAlerts({ templatePausedAt: null, templatePauseReason: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="z-20 flex items-center justify-center gap-3 bg-destructive px-4 py-2 pl-60 text-center text-xs font-medium text-destructive-foreground">
      <span className="inline-flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {t.layout.templateAlert.body} {alerts.templatePauseReason} ({t.layout.templateAlert.since}{' '}
        <span className="tnum font-mono">{fmtDateTime(alerts.templatePausedAt)}</span>).{' '}
        {t.layout.templateAlert.seeRunbook}
      </span>
      {role === 'owner' && (
        <button
          onClick={() => void acknowledge()}
          disabled={busy}
          className="shrink-0 rounded bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30 disabled:opacity-50"
        >
          {busy ? t.layout.templateAlert.resuming : t.layout.templateAlert.acknowledge}
        </button>
      )}
    </div>
  );
}

export default function Layout() {
  const { me, loading, runMode, logout } = useAuth();
  const t = useT();
  if (loading) return <Spinner label={t.layout.loadingApp} />;
  if (!me) return <Navigate to="/login" replace />;

  const nav = [...NAV];
  if (runMode === 'mock' || runMode === 'demo') {
    nav.push({ to: '/simulator', label: (t) => t.nav.simulator, icon: Smartphone });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TemplateAlertBanner role={me.user.role} />
      {IS_DEMO && (
        <div className="z-10 badge-warning px-4 py-1.5 pl-60 text-center text-xs">
          <strong>{t.layout.demoBanner.title}</strong> {t.layout.demoBanner.body}{' '}
          <a
            className="font-semibold underline"
            href="https://github.com/htbot34/Establo#readme"
            target="_blank"
            rel="noreferrer"
          >
            {t.layout.demoBanner.cta}
          </a>
        </div>
      )}
      <div className="flex flex-1">
        <aside className="fixed inset-y-0 flex w-56 flex-col border-r border-border bg-card">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <Logomark className="size-8 shrink-0 text-foreground" title="Establo" />
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight text-foreground">Establo</div>
              <div className="max-w-[150px] truncate text-xs text-muted-foreground">
                {me.org.name}
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-navactive-bg text-navactive-fg'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`
                  }
                >
                  <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                  {item.label(t)}
                  {item.to === '/simulator' && (
                    <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t.nav.mockTag}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
          <div className="border-t border-border px-5 py-4">
            <div className="mb-2 flex items-center justify-end gap-2">
              <LocaleToggle />
              <ThemeToggle />
            </div>
            <div className="truncate text-xs font-medium text-secondary-foreground">
              {me.user.name}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{me.user.email}</div>
            <button
              onClick={() => void logout()}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              {t.layout.signOut}
            </button>
          </div>
        </aside>
        <main className="ml-56 flex-1 px-6 py-7">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
