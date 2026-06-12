import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { api, fmtDateTime, IS_DEMO } from './api';
import { useAuth } from './auth';
import { Spinner } from './components';

const NAV = [
  { to: '/', label: 'Overview', icon: '📊', end: true },
  { to: '/sops', label: 'SOPs', icon: '📄' },
  { to: '/workers', label: 'Workers', icon: '👷' },
  { to: '/onboarding', label: 'Onboarding', icon: '🎓' },
  { to: '/conversations', label: 'Conversations', icon: '💬' },
  { to: '/audit', label: 'Audit & Exports', icon: '🗂️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
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
    const t = setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
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
    <div className="z-20 flex items-center justify-center gap-3 bg-red-600 px-4 py-2 pl-60 text-center text-xs font-medium text-white">
      <span>
        ⚠️ WhatsApp template delivery is failing — possible category change; drip lessons are
        paused for affected workers. {alerts.templatePauseReason} (since{' '}
        {fmtDateTime(alerts.templatePausedAt)}). See RUNBOOK → “Template failure banner”.
      </span>
      {role === 'owner' && (
        <button
          onClick={() => void acknowledge()}
          disabled={busy}
          className="shrink-0 rounded bg-white/20 px-2.5 py-1 font-semibold hover:bg-white/30 disabled:opacity-50"
        >
          {busy ? 'Resuming…' : 'Acknowledge & resume'}
        </button>
      )}
    </div>
  );
}

export default function Layout() {
  const { me, loading, runMode, logout } = useAuth();
  if (loading) return <Spinner label="Loading Establo…" />;
  if (!me) return <Navigate to="/login" replace />;

  const nav = [...NAV];
  if (runMode === 'mock' || runMode === 'demo') {
    nav.push({ to: '/simulator', label: 'Simulator', icon: '📱' });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TemplateAlertBanner role={me.user.role} />
      {IS_DEMO && (
        <div className="z-10 bg-amber-100 px-4 py-1.5 pl-60 text-center text-xs text-amber-900">
          <strong>Hosted demo</strong> — sample dairy, data resets on reload. Answers here are
          verbatim SOP extracts; the full system answers with Claude, voice notes, and real
          WhatsApp.{' '}
          <a
            className="font-semibold underline"
            href="https://github.com/htbot34/Establo#readme"
            target="_blank"
            rel="noreferrer"
          >
            Run the real thing →
          </a>
        </div>
      )}
      <div className="flex flex-1">
      <aside className="fixed inset-y-0 flex w-56 flex-col border-r border-stone-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-2xl">🐄</span>
          <div>
            <div className="text-base font-bold tracking-tight text-green-900">Establo</div>
            <div className="max-w-[150px] truncate text-xs text-stone-500">{me.org.name}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-green-50 text-green-900'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
              {item.to === '/simulator' && (
                <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  MOCK
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 px-5 py-4">
          <div className="truncate text-xs font-medium text-stone-700">{me.user.name}</div>
          <div className="truncate text-xs text-stone-400">{me.user.email}</div>
          <button
            onClick={() => void logout()}
            className="mt-2 text-xs font-medium text-green-800 hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
        <main className="ml-56 flex-1 px-8 py-8">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
