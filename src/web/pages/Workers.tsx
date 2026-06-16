import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, IS_DEMO, timeAgo } from '../api';
import { WORKER_ROLES, WORKER_ROLE_LABELS } from '../../server/services/roles';
import {
  Badge,
  Button,
  Card,
  consentBadge,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
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

const CONSENT_FILTERS = [
  { value: 'all', label: 'All consent states' },
  { value: 'opted_in', label: 'Opted in' },
  { value: 'pending', label: 'Awaiting opt-in' },
  { value: 'opted_out', label: 'Opted out' },
];

function agreementCell(w: WorkerRow) {
  if (!w.agreement) return <span className="text-stone-400">unsigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-stone-600">✓ v{w.agreement.version}</span>
      <span className="text-xs text-stone-400">({w.agreement.method})</span>
      {w.agreement.renewalDue && <Badge color="amber">renewal due</Badge>}
    </span>
  );
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
        title="Workers"
        subtitle="Everyone who can text or send voice notes to Establo"
        actions={
          <>
            {!IS_DEMO && (
              <a href="/api/consent-form" target="_blank" rel="noreferrer">
                <Button variant="secondary">🖨 Print consent form</Button>
              </a>
            )}
            <Button onClick={() => setAdding(true)}>+ Add worker</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <div className="w-52">
          <Select value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)}>
            {CONSENT_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        {rows && consentFilter !== 'all' && (
          <span className="text-xs text-stone-400">
            {visible?.length ?? 0} of {rows.length} workers
          </span>
        )}
      </div>
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
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Consent</th>
                <th className="px-3 py-3 font-medium">Agreement</th>
                <th className="px-3 py-3 font-medium">Onboarding</th>
                <th className="px-3 py-3 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visible!.map((w) => (
                <tr key={w.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3">
                    <Link to={`/workers/${w.id}`} className="font-medium text-green-900 hover:underline">
                      {w.name}
                    </Link>
                    {w.status !== 'active' && <span className="ml-2">{statusBadge(w.status)}</span>}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-stone-600">{w.phoneE164}</td>
                  <td className="px-3 py-3 text-xs text-stone-600">
                    {w.jobRole && WORKER_ROLE_LABELS[w.jobRole as keyof typeof WORKER_ROLE_LABELS] ? (
                      <Badge color="blue">
                        {WORKER_ROLE_LABELS[w.jobRole as keyof typeof WORKER_ROLE_LABELS]}
                      </Badge>
                    ) : (
                      <span className="text-stone-400">unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-3">{consentBadge(w.consentStatus)}</td>
                  <td className="px-3 py-3">{agreementCell(w)}</td>
                  <td className="px-3 py-3 text-stone-600">
                    {w.enrollment ? (
                      <span>
                        {w.enrollment.trackName}
                        <span className="ml-1.5 text-xs text-stone-400">
                          {w.enrollment.modulesAnswered}/{w.enrollment.modulesTotal} modules
                          {w.enrollment.status === 'completed' && ' ✓'}
                        </span>
                        {(w.consentStatus ?? 'opted_in') === 'pending' && (
                          <span className="ml-1.5 text-xs font-medium text-amber-700">
                            — lessons wait for opt-in
                          </span>
                        )}
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
              <Label>Job role (decides which role-specific lessons they receive)</Label>
              <Select value={jobRole} onChange={(e) => setJobRole(e.target.value)}>
                <option value="">Unassigned (universal lessons only)</option>
                {WORKER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {WORKER_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Adding a worker does <strong>not</strong> opt them in. They opt in themselves by
              texting the number (ALTA or any first message), or sign the printable consent form
              and you attest it on their record. Until then Establo sends them nothing.
            </p>
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
