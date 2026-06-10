import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime } from '../api';
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
        <h2 className="mb-3 text-sm font-semibold text-stone-700">Generate an audit pack</h2>
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
        <p className="mt-3 text-xs text-stone-400">
          The pack contains: a formal training-documentation letter (PDF) listing each employee,
          their training dates, topics and check results · the full training-events CSV ·
          per-worker transcript PDFs — all zipped together.
        </p>
      </Card>

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No audit packs yet" hint="Generate your first one above." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-5 py-3 font-medium">Period</th>
                <th className="px-3 py-3 font-medium">Requested</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium text-right">Downloads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3 text-stone-700">
                    {fmtDate(r.periodStart)} → {fmtDate(r.periodEnd)}
                  </td>
                  <td className="px-3 py-3 text-stone-500">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-3 py-3">
                    {statusBadge(r.status)}
                    {r.errorText && <div className="mt-1 text-xs text-red-600">{r.errorText}</div>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.status === 'ready' ? (
                      <div className="flex justify-end gap-3 text-xs font-medium">
                        <a className="text-green-800 hover:underline" href={`${r.letterUrl}?download`}>Letter PDF</a>
                        <a className="text-green-800 hover:underline" href={`${r.csvUrl}?download`}>CSV</a>
                        <a className="text-green-800 hover:underline" href={`${r.downloadUrl}?download`}>Full pack (zip)</a>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
