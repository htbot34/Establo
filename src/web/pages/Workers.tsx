import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  statusBadge,
} from '../components';

export interface WorkerRow {
  id: string;
  name: string;
  phoneE164: string;
  status: string;
  lastInboundAt: string | null;
  notes: string | null;
  enrollment: {
    id: string;
    trackName: string;
    status: string;
    modulesAnswered: number;
    modulesTotal: number;
  } | null;
}

export default function Workers() {
  const [rows, setRows] = useState<WorkerRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+1208555');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        body: { name, phoneE164: phone.trim(), notes: notes || null },
      });
      setAdding(false);
      setName('');
      setPhone('+1208555');
      setNotes('');
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
        title="Workers"
        subtitle="Everyone who can text or send voice notes to Establo"
        actions={<Button onClick={() => setAdding(true)}>+ Add worker</Button>}
      />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No workers yet" hint="Add a worker with their WhatsApp number to get started." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Phone</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Onboarding</th>
                <th className="px-3 py-3 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((w) => (
                <tr key={w.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3">
                    <Link to={`/workers/${w.id}`} className="font-medium text-green-900 hover:underline">
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-stone-600">{w.phoneE164}</td>
                  <td className="px-3 py-3">{statusBadge(w.status)}</td>
                  <td className="px-3 py-3 text-stone-600">
                    {w.enrollment ? (
                      <span>
                        {w.enrollment.trackName}
                        <span className="ml-1.5 text-xs text-stone-400">
                          {w.enrollment.modulesAnswered}/{w.enrollment.modulesTotal} modules
                          {w.enrollment.status === 'completed' && ' ✓'}
                        </span>
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-stone-500">{timeAgo(w.lastInboundAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adding && (
        <Modal title="Add worker" onClose={() => setAdding(false)}>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <div>
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="María Guadalupe Ramírez" />
            </div>
            <div>
              <Label>WhatsApp phone (E.164)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+12085551234" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add worker'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
