import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { IS_DEMO } from './api';
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
