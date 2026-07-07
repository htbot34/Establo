import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, ErrorNote, Input, Label, PageHeader, Textarea } from '../components';
import { useFmt, useT } from '../i18n';

function SavedNote() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 text-sm text-success">
      <Check className="size-4" aria-hidden="true" /> {t.common.saved}
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
  const t = useT();
  const { fmtDate } = useFmt();

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
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />
      <ErrorNote error={error} />

      <Card className="mb-4 max-w-xl p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t.settings.orgTitle}</h2>
        <form onSubmit={(e) => void save(e)} className="space-y-3">
          <div>
            <Label>{t.settings.dairyName}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t.settings.timezoneLabel}</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
            </div>
            <div>
              <Label>{t.settings.herdSizeLabel}</Label>
              <Input type="number" min={1} value={herdSize} onChange={(e) => setHerdSize(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">{t.common.save}</Button>
            {saved && <SavedNote />}
          </div>
        </form>
      </Card>

      <Card className="mb-4 max-w-xl p-5">
        <h2 className="mb-2 text-sm font-medium text-foreground">{t.settings.runModeTitle}</h2>
        <p className="text-sm text-foreground">
          {t.settings.runModeBefore}{' '}
          <Badge color={runMode === 'production' ? 'green' : 'amber'}>{runMode}</Badge>
          {t.settings.runModeAfter}
        </p>
      </Card>

      {keywordsText !== null && (
        <Card className="mb-4 max-w-xl p-5">
          <h2 className="mb-1 text-sm font-medium text-foreground">{t.settings.keywordsTitle}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t.settings.keywordsHint}</p>
          <Textarea
            rows={5}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder={'ácido\nsala de espera\namoniaco'}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={() => void saveKeywords()}>{t.settings.saveKeywords}</Button>
            {keywordsSaved && <SavedNote />}
          </div>
        </Card>
      )}

      {agreement && (
        <Card className="mb-4 max-w-xl p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            {t.settings.agreementTitle}
            <Badge color="stone">
              <span className="font-mono">v{agreement.version}</span>
            </Badge>
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {t.settings.agreementHint}{' '}
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
              {t.settings.saveNewVersion}
            </Button>
            {agreementSaved && <SavedNote />}
          </div>
        </Card>
      )}

      {billing?.enabled && (
        <Card className="max-w-xl p-5">
          <h2 className="mb-2 text-sm font-medium text-foreground">{t.settings.billingTitle}</h2>
          {billing.billing.active ? (
            <p className="text-sm text-foreground">
              {t.settings.subscription} <Badge color="green">{t.settings.activeBadge}</Badge>{' '}
              {t.settings.subscriptionActiveTail}
            </p>
          ) : (
            <div>
              <p className="mb-3 text-sm text-foreground">
                {t.settings.noSubscription1}{' '}
                <span className="font-mono tabular-nums">{me?.org.herdSize ?? '—'}</span>{' '}
                {t.settings.noSubscription2}
              </p>
              <Button onClick={() => void checkout()}>{t.settings.setupStripe}</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
