import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, IS_DEMO } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorNote, Input, Label } from '../components';

export default function Login() {
  const [tab, setTab] = useState<'login' | 'setup'>('login');
  const [email, setEmail] = useState(IS_DEMO ? 'demo@establo.app' : '');
  const [password, setPassword] = useState(IS_DEMO ? 'establo-demo-2026' : '');
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('America/Boise');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
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
          body: { orgName, timezone, name, email, password },
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
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">🐄</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-green-900">Establo</h1>
          <p className="mt-1 text-sm text-stone-500">
            WhatsApp training & SOP assistance for your dairy
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 text-sm font-medium">
            {(['login', 'setup'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={`rounded-md py-1.5 ${tab === t ? 'bg-white shadow-sm' : 'text-stone-500'}`}
              >
                {t === 'login' ? 'Sign in' : 'Set up a dairy'}
              </button>
            ))}
          </div>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            {tab === 'setup' && (
              <>
                <div>
                  <Label>Dairy / organization name</Label>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required placeholder="Rancho Vista Lechería" />
                </div>
                <div>
                  <Label>Timezone</Label>
                  <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder="America/Boise" />
                </div>
                <div>
                  <Label>Your name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
              </>
            )}
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </div>
            <div>
              <Label>Password</Label>
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
              {busy ? 'Working…' : tab === 'login' ? 'Sign in' : 'Create dairy + owner account'}
            </Button>
          </form>
          {tab === 'login' && (
            <p className="mt-4 text-center text-xs text-stone-400">
              Demo: demo@establo.app / establo-demo-2026
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
