import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
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

interface Track {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  moduleCount: number;
  activeEnrollments: number;
  completedEnrollments: number;
}

export default function Onboarding() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTracks(await api<Track[]>('/api/tracks'));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/tracks', { method: 'POST', body: { name, description: description || null } });
      setCreating(false);
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle="Scheduled training tracks delivered over WhatsApp, with one-question checks"
        actions={<Button onClick={() => setCreating(true)}>+ New track</Button>}
      />
      {!tracks ? (
        <Spinner />
      ) : tracks.length === 0 ? (
        <Card>
          <EmptyState title="No tracks yet" hint="Create a track, then add or generate modules from an SOP." />
        </Card>
      ) : (
        <div className="space-y-3">
          {tracks.map((t) => (
            <Card key={t.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <Link
                  to={`/onboarding/${t.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t.name}
                </Link>
                {!t.active && <span className="ml-2">{statusBadge('paused')}</span>}
                {t.description && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{t.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-5 text-center text-sm">
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {t.moduleCount}
                  </div>
                  <div className="text-xs text-muted-foreground">modules</div>
                </div>
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {t.activeEnrollments}
                  </div>
                  <div className="text-xs text-muted-foreground">in progress</div>
                </div>
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {t.completedEnrollments}
                  </div>
                  <div className="text-xs text-muted-foreground">completed</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="New onboarding track" onClose={() => setCreating(false)}>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void create(e)} className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Inducción — Primeras 2 semanas" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit">Create track</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
