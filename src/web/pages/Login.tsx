import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, IS_DEMO } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorNote, Input, Label } from '../components';
import { useT } from '../i18n';
import { Logomark } from '../brand/Logomark';

export default function Login() {
  const [tab, setTab] = useState<'login' | 'setup'>('login');
  const [email, setEmail] = useState(IS_DEMO ? 'demo@establo.app' : '');
  const [password, setPassword] = useState(IS_DEMO ? 'establo-demo-2026' : '');
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Boise');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') {
        await api('/api/auth/login', { method: 'POST', body: { email, password } });
      } else {
        await api('/api/auth/setup', {
          method: 'POST',
          body: { orgName, timezone, name, email, password, setupToken },
        });
      }
      await refresh();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logomark className="size-11 text-foreground" title="Establo" />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Establo</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.login.tagline}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm font-medium">
            {(['login', 'setup'] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => {
                  setTab(tabKey);
                  setError(null);
                }}
                className={`rounded-sm py-1.5 transition-colors ${
                  tab === tabKey ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {tabKey === 'login' ? t.login.signIn : t.login.setUpDairy}
              </button>
            ))}
          </div>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            {tab === 'setup' && (
              <>
                <div>
                  <Label>{t.login.orgName}</Label>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required placeholder="Rancho Vista Lechería" />
                </div>
                <div>
                  <Label>{t.login.timezone}</Label>
                  <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder="America/Boise" />
                </div>
                <div>
                  <Label>{t.login.yourName}</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div>
                  <Label>{t.login.setupToken}</Label>
                  <Input
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    required
                    placeholder={t.login.setupTokenPlaceholder}
                  />
                </div>
              </>
            )}
            <div>
              <Label>{t.login.email}</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </div>
            <div>
              <Label>{t.login.password}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={tab === 'setup' ? 8 : undefined}
                autoComplete={tab === 'setup' ? 'new-password' : 'current-password'}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t.common.working : tab === 'login' ? t.login.signIn : t.login.createDairy}
            </Button>
          </form>
          {tab === 'login' && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {t.login.demoPrefix} <span className="font-mono">demo@establo.app / establo-demo-2026</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
