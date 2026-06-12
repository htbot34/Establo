import { useEffect, type ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const styles: Record<string, string> = {
    primary:
      'bg-green-800 text-white hover:bg-green-900 disabled:bg-stone-300 disabled:text-stone-500',
    secondary:
      'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:text-stone-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-stone-300',
    ghost: 'text-stone-600 hover:bg-stone-100 disabled:text-stone-400',
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700 ${props.className ?? ''}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-green-700 focus:outline-none ${props.className ?? ''}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-stone-600">{children}</label>;
}

const BADGE_COLORS: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  stone: 'bg-stone-200 text-stone-700',
  blue: 'bg-sky-100 text-sky-800',
};

export function Badge({ color = 'stone', children }: { color?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_COLORS[color] ?? BADGE_COLORS.stone}`}
    >
      {children}
    </span>
  );
}

export function statusBadge(status: string): ReactNode {
  const map: Record<string, string> = {
    ready: 'green',
    processing: 'amber',
    uploaded: 'blue',
    failed: 'red',
    active: 'green',
    inactive: 'stone',
    completed: 'blue',
    paused: 'amber',
    open: 'red',
    resolved: 'green',
    pending: 'stone',
    notified: 'amber',
    sent: 'blue',
    answered: 'green',
  };
  return <Badge color={map[status] ?? 'stone'}>{status}</Badge>;
}

/** WhatsApp consent state (Meta opt-in policy). */
export function consentBadge(status: string | null | undefined): ReactNode {
  const map: Record<string, { color: string; label: string }> = {
    opted_in: { color: 'green', label: 'opted in' },
    pending: { color: 'amber', label: 'awaiting opt-in' },
    opted_out: { color: 'red', label: 'opted out' },
  };
  const m = map[status ?? ''] ?? { color: 'stone', label: status ?? '—' };
  return <Badge color={m.color}>{m.label}</Badge>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-stone-500">
      <svg className="h-5 w-5 animate-spin text-green-800" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm font-medium text-stone-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 pt-16"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

/** Tiny inline SVG sparkline for the overview page. */
export function Sparkline({ data }: { data: Array<{ date: string; count: number }> }) {
  const W = 560;
  const H = 64;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const points = data
    .map((d, i) => `${(i * step).toFixed(1)},${(H - 6 - (d.count / max) * (H - 14)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none">
      <polyline
        points={`0,${H} ${points} ${W},${H}`}
        fill="rgb(22 101 52 / 0.08)"
        stroke="none"
      />
      <polyline points={points} fill="none" stroke="rgb(22 101 52)" strokeWidth="2" />
      {data.map((d, i) => (
        <circle
          key={d.date}
          cx={i * step}
          cy={H - 6 - (d.count / max) * (H - 14)}
          r="2.4"
          fill="rgb(22 101 52)"
        >
          <title>{`${d.date}: ${d.count} events`}</title>
        </circle>
      ))}
    </svg>
  );
}
