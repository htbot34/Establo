import { type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './lib/utils';
import { ButtonBase } from './ui/button';
import { CardRoot } from './ui/card';
import { BadgeBase } from './ui/badge';
import { InputBase } from './ui/input';
import { TextareaBase } from './ui/textarea';
import { LabelBase } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <CardRoot className={className}>{children}</CardRoot>;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
};

const BUTTON_VARIANT = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
} as const;

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <ButtonBase variant={BUTTON_VARIANT[variant]} className={className} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <InputBase {...props} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <TextareaBase {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.className,
      )}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <LabelBase className="mb-1 block">{children}</LabelBase>;
}

/** Maps the legacy color names to the token-driven badge variants. */
const BADGE_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
  stone: 'neutral',
  blue: 'info',
};

export function Badge({ color = 'stone', children }: { color?: string; children: ReactNode }) {
  return <BadgeBase variant={BADGE_VARIANT[color] ?? 'neutral'}>{children}</BadgeBase>;
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
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm font-medium text-secondary-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Modal keeps its original prop API but is now a thin wrapper over the shadcn
 * Dialog (Radix): Escape-to-close and click-outside both resolve to onClose.
 */
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'max-h-[85vh] overflow-y-auto',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </div>
  );
}

/** Tiny inline SVG sparkline for the overview page (evergreen, theme-aware). */
export function Sparkline({ data }: { data: Array<{ date: string; count: number }> }) {
  const W = 560;
  const H = 64;
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const points = data
    .map((d, i) => `${(i * step).toFixed(1)},${(H - 6 - (d.count / max) * (H - 14)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full text-ever-600" preserveAspectRatio="none">
      <polyline
        points={`0,${H} ${points} ${W},${H}`}
        className="text-ever-600 opacity-[0.10]"
        fill="currentColor"
        stroke="none"
      />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      {data.map((d, i) => (
        <circle
          key={d.date}
          cx={i * step}
          cy={H - 6 - (d.count / max) * (H - 14)}
          r="2.4"
          fill="currentColor"
        >
          <title>{`${d.date}: ${d.count} events`}</title>
        </circle>
      ))}
    </svg>
  );
}
