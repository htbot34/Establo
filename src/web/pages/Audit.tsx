import { useCallback, useEffect, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { api, fmtDate, fmtDateTime, IS_DEMO } from '../api';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  PageHeader,
  Spinner,
  statusBadge,
} from '../components';
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

const columns: ColumnDef<AuditExportRow>[] = [
  {
    accessorKey: 'periodStart',
    header: 'Period',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-foreground">
        {fmtDate(row.original.periodStart)} – {fmtDate(row.original.periodEnd)}
      </span>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Requested',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
        {fmtDateTime(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <div>
        {statusBadge(row.original.status)}
        {row.original.errorText && (
          <div className="mt-1 text-xs text-destructive">{row.original.errorText}</div>
        )}
      </div>
    ),
  },
  {
    id: 'downloads',
    header: 'Downloads',
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
              Letter PDF
            </a>
          )}
          {r.csvUrl && (
            <a
              className="text-primary hover:underline"
              href={IS_DEMO ? r.csvUrl : `${r.csvUrl}?download`}
              download={IS_DEMO ? 'training-events.csv' : undefined}
            >
              CSV
            </a>
          )}
          {r.downloadUrl && (
            <a
              className="text-primary hover:underline"
              href={IS_DEMO ? r.downloadUrl : `${r.downloadUrl}?download`}
            >
              Full pack (zip)
            </a>
          )}
          {IS_DEMO && !r.letterUrl && (
            <span className="text-muted-foreground">PDF/zip: backend only</span>
          )}
        </div>
      );
    },
  },
];

export default function Audit() {
  const [rows, setRows] = useState<AuditExportRow[] | null>(null);
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(isoDaysAgo(0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<AuditExportRow[]>('/api/audit/exports'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is generating.
  useEffect(() => {
    if (!rows?.some((r) => r.status === 'pending' || r.status === 'processing')) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
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
      <PageHeader
        title="Audit & Exports"
        subtitle="One click produces the documentation pack for a FARM evaluation or investigation"
      />
      <ErrorNote error={error} />

      <Card className="mb-5 p-5">
        <h2 className="mb-3 text-sm font-medium text-foreground">Generate an audit pack</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>From</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? 'Starting…' : 'Generate audit pack'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The pack contains: a formal training-documentation letter (PDF) listing each employee,
          their training dates, topics and check results · the full training-events CSV ·
          per-worker transcript PDFs — all zipped together.
        </p>
        {IS_DEMO && (
          <p className="mt-2 text-xs font-medium text-warning">
            Hosted demo: the CSV is generated right here in your browser; the letter PDF and
            transcripts zip are produced by the real backend (run locally to see them).
          </p>
        )}
      </Card>

      {!rows ? (
        <Card>
          <Spinner />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No audit packs yet" hint="Generate your first one above." />
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
