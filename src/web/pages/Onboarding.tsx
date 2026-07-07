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
  StatusBadge,
  Textarea,
} from '../components';
import { useT } from '../i18n';

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
  const t = useT();

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
        title={t.onboarding.title}
        subtitle={t.onboarding.subtitle}
        actions={<Button onClick={() => setCreating(true)}>{t.onboarding.newTrack}</Button>}
      />
      {!tracks ? (
        <Spinner />
      ) : tracks.length === 0 ? (
        <Card>
          <EmptyState title={t.onboarding.emptyTitle} hint={t.onboarding.emptyHint} />
        </Card>
      ) : (
        <div className="space-y-3">
          {tracks.map((track) => (
            <Card key={track.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <Link
                  to={`/onboarding/${track.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {track.name}
                </Link>
                {!track.active && (
                  <span className="ml-2">
                    <StatusBadge status="paused" />
                  </span>
                )}
                {track.description && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{track.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-5 text-center text-sm">
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {track.moduleCount}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.onboarding.modules}</div>
                </div>
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {track.activeEnrollments}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.onboarding.inProgress}</div>
                </div>
                <div>
                  <div className="font-mono font-medium tabular-nums text-foreground">
                    {track.completedEnrollments}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.onboarding.completed}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal title={t.onboarding.modalTitle} onClose={() => setCreating(false)}>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void create(e)} className="space-y-3">
            <div>
              <Label>{t.onboarding.nameLabel}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Inducción — Primeras 2 semanas" />
            </div>
            <div>
              <Label>{t.onboarding.descriptionLabel}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>{t.common.cancel}</Button>
              <Button type="submit">{t.onboarding.createTrack}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
