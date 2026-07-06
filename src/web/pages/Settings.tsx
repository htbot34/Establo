import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { api, fmtDate } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, ErrorNote, Input, Label, PageHeader, Textarea } from '../components';

function SavedNote() {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-success">
      <Check className="size-4" aria-hidden="true" /> Saved
    </span>
  );
}

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
  // Forced-escalation keywords, one per textarea line. null = not loaded
  // (e.g. the static demo has no GET /api/org) → the section stays hidden.
  const [keywordsText, setKeywordsText] = useState<string | null>(null);
  const [keywordsSaved, setKeywordsSaved] = useState(false);

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
    void api<{ escalationKeywords: string[] }>('/api/org')
      .then((o) => setKeywordsText(o.escalationKeywords.join('\n')))
      .catch(() => {});
  }, []);

  async function saveKeywords() {
    setError(null);
    setKeywordsSaved(false);
    try {
      const list = (keywordsText ?? '')
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean);
      const o = await api<{ escalationKeywords: string[] }>('/api/org', {
        method: 'PATCH',
        body: { escalationKeywords: list },
      });
      setKeywordsText(o.escalationKeywords.join('\n'));
      setKeywordsSaved(true);
      setTimeout(() => setKeywordsSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
        <h2 className="mb-4 text-sm font-medium text-foreground">Organization</h2>
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
            {saved && <SavedNote />}
          </div>
        </form>
      </Card>

      <Card className="mb-4 max-w-xl p-5">
        <h2 className="mb-2 text-sm font-medium text-foreground">Run mode</h2>
        <p className="text-sm text-foreground">
          This server is running in{' '}
          <Badge color={runMode === 'production' ? 'green' : 'amber'}>{runMode}</Badge> mode. See the
          README for the path from mock to sandbox to production.
        </p>
      </Card>

      {keywordsText !== null && (
        <Card className="mb-4 max-w-xl p-5">
          <h2 className="mb-1 text-sm font-medium text-foreground">
            Forced-escalation keywords
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            One keyword per line. Any worker question containing one of these words (accents and
            capitalization don't matter) is answered normally but always flagged for you as an
            escalation — useful for chemicals, equipment, or topics you want to hear about
            personally.
          </p>
          <Textarea
            rows={5}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder={'ácido\nsala de espera\namoniaco'}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void saveKeywords()}>Save keywords</Button>
            {keywordsSaved && <SavedNote />}
          </div>
        </Card>
      )}

      {agreement && (
        <Card className="mb-4 max-w-xl p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            Cow care agreement
            <Badge color="stone">
              <span className="font-mono">v{agreement.version}</span>
            </Badge>
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            FARM Animal Care v5 expects every employee with animal care responsibilities to sign
            this, renewed annually. Workers sign by replying ACEPTO on WhatsApp. Editing the text
            creates a new version; existing signatures keep their version. Current version since{' '}
            <span className="font-mono tabular-nums">{fmtDate(agreement.createdAt)}</span>.
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
            {agreementSaved && <SavedNote />}
          </div>
        </Card>
      )}

      {billing?.enabled && (
        <Card className="max-w-xl p-5">
          <h2 className="mb-2 text-sm font-medium text-foreground">Billing</h2>
          {billing.billing.active ? (
            <p className="text-sm text-foreground">
              Subscription <Badge color="green">active</Badge> — base fee + per-cow pricing.
            </p>
          ) : (
            <div>
              <p className="mb-3 text-sm text-foreground">
                No active subscription. Establo bills a flat base fee plus a per-cow amount (your
                herd size: <span className="font-mono tabular-nums">{me?.org.herdSize ?? '—'}</span>{' '}
                cows).
              </p>
              <Button onClick={() => void checkout()}>Set up billing with Stripe</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
