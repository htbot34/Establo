import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Printer } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api, IS_DEMO } from '../api';
import { WORKER_ROLES } from '../../server/services/roles';
import {
  Badge,
  Button,
  Card,
  ConsentBadge,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from '../components';
import { useFmt, useT, type Dictionary } from '../i18n';
import { DataTable } from '../ui/data-table';

export interface WorkerRow {
  id: string;
  name: string;
  phoneE164: string;
  status: string;
  lastInboundAt: string | null;
  notes: string | null;
  jobRole?: string | null;
  consentStatus?: string;
  consentedAt?: string | null;
  consentMethod?: string | null;
  enrollment: {
    id: string;
    trackName: string;
    status: string;
    modulesAnswered: number;
    modulesTotal: number;
  } | null;
  agreement?: {
    signedAt: string;
    version: number;
    method: string;
    renewalDue: boolean;
  } | null;
}

function AgreementCell({ w }: { w: WorkerRow }) {
  const t = useT();
  if (!w.agreement) return <span className="text-muted-foreground">{t.workers.unsigned}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-foreground">
        <Check className="size-3.5 text-success" aria-hidden="true" />
        <span className="font-mono">v{w.agreement.version}</span>
      </span>
      <span className="text-xs text-muted-foreground">({w.agreement.method})</span>
      {w.agreement.renewalDue && <Badge color="amber">{t.workers.renewalDue}</Badge>}
    </span>
  );
}

function roleLabel(t: Dictionary, jobRole: string | null | undefined): string {
  return (jobRole && t.roles[jobRole as keyof Dictionary['roles']]) || '';
}

export default function Workers() {
  const [rows, setRows] = useState<WorkerRow[] | null>(null);
  const [consentFilter, setConsentFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+1208555');
  const [jobRole, setJobRole] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const { timeAgo } = useFmt();

  const consentFilters = [
    { value: 'all', label: t.workers.filterAll },
    { value: 'opted_in', label: t.workers.filterOptedIn },
    { value: 'pending', label: t.workers.filterPending },
    { value: 'opted_out', label: t.workers.filterOptedOut },
  ];

  const columns = useMemo<ColumnDef<WorkerRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t.workers.colName,
        cell: ({ row }) => {
          const w = row.original;
          return (
            <span className="flex items-center gap-2">
              <Link to={`/workers/${w.id}`} className="font-medium text-primary hover:underline">
                {w.name}
              </Link>
              {w.status !== 'active' && <StatusBadge status={w.status} />}
            </span>
          );
        },
      },
      {
        accessorKey: 'phoneE164',
        header: t.workers.colPhone,
        meta: { cellClassName: 'font-mono text-xs text-muted-foreground' },
      },
      {
        id: 'role',
        accessorFn: (w) => roleLabel(t, w.jobRole),
        header: t.workers.colRole,
        cell: ({ row }) => {
          const label = roleLabel(t, row.original.jobRole);
          return label ? (
            <Badge color="blue">{label}</Badge>
          ) : (
            <span className="text-muted-foreground">{t.workers.unassigned}</span>
          );
        },
      },
      {
        id: 'consent',
        accessorFn: (w) => w.consentStatus ?? 'opted_in',
        header: t.workers.colConsent,
        cell: ({ row }) => <ConsentBadge status={row.original.consentStatus} />,
      },
      {
        id: 'agreement',
        header: t.workers.colAgreement,
        enableSorting: false,
        cell: ({ row }) => <AgreementCell w={row.original} />,
      },
      {
        id: 'onboarding',
        header: t.workers.colOnboarding,
        enableSorting: false,
        cell: ({ row }) => {
          const w = row.original;
          if (!w.enrollment) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-foreground">
              {w.enrollment.trackName}
              <span className="ml-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                {w.enrollment.modulesAnswered}/{w.enrollment.modulesTotal} {t.workers.modulesCount}
              </span>
              {w.enrollment.status === 'completed' && (
                <Check className="ml-1 inline size-3.5 text-success" aria-hidden="true" />
              )}
              {(w.consentStatus ?? 'opted_in') === 'pending' && (
                <span className="ml-1.5 text-xs font-medium text-warning">
                  {t.workers.lessonsWaitOptIn}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'lastActive',
        accessorFn: (w) => w.lastInboundAt ?? '',
        header: t.workers.colLastActive,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{timeAgo(row.original.lastInboundAt)}</span>
        ),
      },
    ],
    [t, timeAgo],
  );

  const load = useCallback(async () => {
    setRows(await api<WorkerRow[]>('/api/workers'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/workers', {
        method: 'POST',
        body: { name, phoneE164: phone.trim(), jobRole: jobRole || null, notes: notes || null },
      });
      setAdding(false);
      setName('');
      setPhone('+1208555');
      setJobRole('');
      setNotes('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = rows?.filter(
    (w) => consentFilter === 'all' || (w.consentStatus ?? 'opted_in') === consentFilter,
  );

  return (
    <div>
      <PageHeader
        title={t.workers.title}
        subtitle={t.workers.subtitle}
        actions={
          <>
            {!IS_DEMO && (
              <a href="/api/consent-form" target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <Printer aria-hidden="true" /> {t.workers.printConsentForm}
                </Button>
              </a>
            )}
            <Button onClick={() => setAdding(true)}>{t.workers.addWorker}</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <div className="w-52">
          <Select value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)}>
            {consentFilters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        {rows && consentFilter !== 'all' && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {t.workers.countOf(visible?.length ?? 0, rows.length)}
          </span>
        )}
      </div>
      {!rows ? (
        <Card>
          <Spinner />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t.workers.emptyTitle} hint={t.workers.emptyHint} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            data={visible ?? []}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyState={<EmptyState title={t.workers.noFilterMatch} />}
          />
        </Card>
      )}

      {adding && (
        <Modal title={t.workers.addTitle} onClose={() => setAdding(false)}>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <div>
              <Label>{t.workers.fullName}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="María Guadalupe Ramírez" />
            </div>
            <div>
              <Label>{t.workers.phoneLabel}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+12085551234" />
            </div>
            <div>
              <Label>{t.workers.jobRoleLabel}</Label>
              <Select value={jobRole} onChange={(e) => setJobRole(e.target.value)}>
                <option value="">{t.workers.unassignedOption}</option>
                {WORKER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t.workers.notesLabel}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <p className="badge-warning rounded-md px-3 py-2 text-xs">
              {t.workers.optInNote1} <strong>{t.workers.optInNoteNot}</strong>{' '}
              {t.workers.optInNote2}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t.workers.adding : t.workers.addTitle}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
