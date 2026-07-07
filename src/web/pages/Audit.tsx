import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { api, IS_DEMO } from '../api';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../components';
import { useFmt, useT } from '../i18n';
import { DataTable } from '../ui/data-table';

interface AuditExportRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  errorText: string | null;
  createdAt: string;
  downloadUrl: string | null;
  letterUrl: string | null;
  csvUrl: string | null;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default function Audit() {
  const [rows, setRows] = useState<AuditExportRow[] | null>(null);
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(isoDaysAgo(0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const { fmtDate, fmtDateTime } = useFmt();

  const columns = useMemo<ColumnDef<AuditExportRow>[]>(
    () => [
      {
        accessorKey: 'periodStart',
        header: t.audit.colPeriod,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-foreground">
            {fmtDate(row.original.periodStart)} – {fmtDate(row.original.periodEnd)}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t.audit.colRequested,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-muted-foreground">
            {fmtDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t.audit.colStatus,
        cell: ({ row }) => (
          <div>
            <StatusBadge status={row.original.status} />
            {row.original.errorText && (
              <div className="mt-1 text-xs text-destructive">{row.original.errorText}</div>
            )}
          </div>
        ),
      },
      {
        id: 'downloads',
        header: t.audit.colDownloads,
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          if (r.status !== 'ready')
            return <span className="font-mono text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex justify-end gap-3 text-xs font-medium">
              {r.letterUrl && (
                <a
                  className="text-primary hover:underline"
                  href={IS_DEMO ? r.letterUrl : `${r.letterUrl}?download`}
                >
                  {t.audit.letterPdf}
                </a>
              )}
              {r.csvUrl && (
                <a
                  className="text-primary hover:underline"
                  href={IS_DEMO ? r.csvUrl : `${r.csvUrl}?download`}
                  download={IS_DEMO ? 'training-events.csv' : undefined}
                >
                  {t.audit.csv}
                </a>
              )}
              {r.downloadUrl && (
                <a
                  className="text-primary hover:underline"
                  href={IS_DEMO ? r.downloadUrl : `${r.downloadUrl}?download`}
                >
                  {t.audit.fullPack}
                </a>
              )}
              {IS_DEMO && !r.letterUrl && (
                <span className="text-muted-foreground">{t.audit.pdfBackendOnly}</span>
              )}
            </div>
          );
        },
      },
    ],
    [t, fmtDate, fmtDateTime],
  );

  const load = useCallback(async () => {
    setRows(await api<AuditExportRow[]>('/api/audit/exports'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is generating.
  useEffect(() => {
    if (!rows?.some((r) => r.status === 'pending' || r.status === 'processing')) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [rows, load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/audit/exports', { method: 'POST', body: { periodStart: start, periodEnd: end } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />
      <ErrorNote error={error} />

      <Card className="mb-5 p-5">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t.audit.generateTitle}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>{t.audit.from}</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>{t.audit.to}</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? t.audit.starting : t.audit.generate}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t.audit.packContains}</p>
        {IS_DEMO && (
          <p className="mt-2 text-xs font-medium text-warning">{t.audit.demoNote}</p>
        )}
      </Card>

      {!rows ? (
        <Card>
          <Spinner />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t.audit.emptyTitle} hint={t.audit.emptyHint} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            data={rows}
            initialSorting={[{ id: 'createdAt', desc: true }]}
          />
        </Card>
      )}
    </div>
  );
}
