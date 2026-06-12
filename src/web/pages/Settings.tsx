import { useEffect, useState, type FormEvent } from 'react';
import { api, fmtDate } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, ErrorNote, Input, Label, PageHeader, Textarea } from '../components';

interface BillingStatus {
  enabled: boolean;
  billing: { active?: boolean };
}

interface Agreement {
  id: string;
  version: number;
  textEs: string;
  createdAt: string;
}

export default function Settings() {
  const { me, refresh, runMode } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [herdSize, setHerdSize] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [agreementText, setAgreementText] = useState('');
  const [agreementSaved, setAgreementSaved] = useState(false);

  useEffect(() => {
    if (me) {
      setName(me.org.name);
      setTimezone(me.org.timezone);
      setHerdSize(me.org.herdSize ? String(me.org.herdSize) : '');
    }
  }, [me]);
  useEffect(() => {
    void api<BillingStatus>('/api/billing/status').then(setBilling).catch(() => {});
    void api<Agreement>('/api/agreement')
      .then((a) => {
        setAgreement(a);
        setAgreementText(a.textEs);
      })
      .catch(() => {});
  }, []);

  async function saveAgreement() {
    setError(null);
    setAgreementSaved(false);
    try {
      const a = await api<Agreement>('/api/agreement', {
        method: 'PATCH',
        body: { textEs: agreementText },
      });
      setAgreement(a);
      setAgreementText(a.textEs);
      setAgreementSaved(true);
      setTimeout(() => setAgreementSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api('/api/org', {
        method: 'PATCH',
        body: { name, timezone, herdSize: herdSize ? Number(herdSize) : null },
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function checkout() {
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/api/billing/checkout', { method: 'POST' });
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Organization details and billing" />
      <ErrorNote error={error} />

      <Card className="mb-4 max-w-xl p-5">
        <h2 className="mb-4 text-sm font-semibold text-stone-700">Organization</h2>
        <form onSubmit={(e) => void save(e)} className="space-y-3">
          <div>
            <Label>Dairy name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Timezone (drip schedule uses this)</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
            </div>
            <div>
              <Label>Herd size (cows)</Label>
              <Input type="number" min={1} value={herdSize} onChange={(e) => setHerdSize(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Save</Button>
            {saved && <span className="text-sm text-green-700">Saved ✓</span>}
          </div>
        </form>
      </Card>

      <Card className="mb-4 max-w-xl p-5">
        <h2 className="mb-2 text-sm font-semibold text-stone-700">Run mode</h2>
        <p className="text-sm text-stone-600">
          This server is running in <Badge color={runMode === 'production' ? 'green' : 'amber'}>{runMode}</Badge>{' '}
          mode. See the README for the path from mock → sandbox → production.
        </p>
      </Card>

      {agreement && (
        <Card className="mb-4 max-w-xl p-5">
          <h2 className="mb-1 text-sm font-semibold text-stone-700">
            Cow care agreement{' '}
            <Badge color="stone">v{agreement.version}</Badge>
          </h2>
          <p className="mb-3 text-xs text-stone-400">
            FARM Animal Care v5 expects every employee with animal care responsibilities to sign
            this, renewed annually. Workers sign by replying ACEPTO on WhatsApp. Editing the text
            creates version {agreement.version + 1}; existing signatures keep their version.
            Current version since {fmtDate(agreement.createdAt)}.
          </p>
          <Textarea
            rows={12}
            value={agreementText}
            onChange={(e) => setAgreementText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => void saveAgreement()}
              disabled={agreementText.trim() === agreement.textEs.trim()}
            >
              Save as new version
            </Button>
            {agreementSaved && <span className="text-sm text-green-700">Saved ✓</span>}
          </div>
        </Card>
      )}

      {billing?.enabled && (
        <Card className="max-w-xl p-5">
          <h2 className="mb-2 text-sm font-semibold text-stone-700">Billing</h2>
          {billing.billing.active ? (
            <p className="text-sm text-stone-600">
              Subscription <Badge color="green">active</Badge> — base fee + per-cow pricing.
            </p>
          ) : (
            <div>
              <p className="mb-3 text-sm text-stone-600">
                No active subscription. Establo bills a flat base fee plus a per-cow amount
                (your herd size: {me?.org.herdSize ?? '—'} cows).
              </p>
              <Button onClick={() => void checkout()}>Set up billing with Stripe</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
