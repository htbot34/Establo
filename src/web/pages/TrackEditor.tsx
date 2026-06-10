import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import {
  Button,
  Card,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components';

interface ModuleRow {
  id: string;
  orderIndex: number;
  dayOffset: number;
  sendHourLocal: number;
  title: string;
  bodyEs: string;
  checkQuestionEs: string;
  checkOptionsEs: string[];
  checkCorrectIndex: number;
}

interface TrackDetail {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  modules: ModuleRow[];
}

interface SopDoc {
  id: string;
  title: string;
  status: string;
}

const EMPTY_MODULE = {
  title: '',
  bodyEs: '',
  checkQuestionEs: '',
  checkOptionsEs: ['', '', ''] as string[],
  checkCorrectIndex: 0,
  dayOffset: 0,
  sendHourLocal: 7,
};

export default function TrackEditor() {
  const { trackId } = useParams<{ trackId: string }>();
  const [track, setTrack] = useState<TrackDetail | null>(null);
  const [editing, setEditing] = useState<ModuleRow | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_MODULE);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genDocId, setGenDocId] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [docs, setDocs] = useState<SopDoc[]>([]);

  const load = useCallback(async () => {
    setTrack(await api<TrackDetail>(`/api/tracks/${trackId}`));
  }, [trackId]);
  useEffect(() => {
    void load();
    void api<SopDoc[]>('/api/sops').then((d) => setDocs(d.filter((x) => x.status === 'ready')));
  }, [load]);

  if (!track) return <Spinner />;

  function openEditor(mod: ModuleRow | 'new') {
    setError(null);
    setEditing(mod);
    setForm(
      mod === 'new'
        ? EMPTY_MODULE
        : {
            title: mod.title,
            bodyEs: mod.bodyEs,
            checkQuestionEs: mod.checkQuestionEs,
            checkOptionsEs: [...mod.checkOptionsEs],
            checkCorrectIndex: mod.checkCorrectIndex,
            dayOffset: mod.dayOffset,
            sendHourLocal: mod.sendHourLocal,
          },
    );
  }

  async function saveModule(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing === 'new') {
        await api(`/api/tracks/${track!.id}/modules`, { method: 'POST', body: form });
      } else if (editing) {
        await api(`/api/modules/${editing.id}`, { method: 'PATCH', body: form });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const ids = track!.modules.map((m) => m.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await api(`/api/tracks/${track!.id}/reorder`, { method: 'POST', body: { moduleIds: ids } });
    await load();
  }

  async function removeModule(m: ModuleRow) {
    if (!window.confirm(`Delete module "${m.title}"?`)) return;
    await api(`/api/modules/${m.id}`, { method: 'DELETE' });
    await load();
  }

  async function generate() {
    setGenBusy(true);
    setError(null);
    try {
      await api(`/api/tracks/${track!.id}/generate`, {
        method: 'POST',
        body: { documentId: genDocId, moduleCount: 3 },
      });
      setGenerating(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-2 text-xs">
        <Link to="/onboarding" className="text-green-800 hover:underline">← Onboarding</Link>
      </div>
      <PageHeader
        title={track.name}
        subtitle={track.description ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => { setError(null); setGenerating(true); }}>
              ✨ Generate from SOP
            </Button>
            <Button onClick={() => openEditor('new')}>+ Add module</Button>
          </>
        }
      />
      <ErrorNote error={generating || editing ? null : error} />

      <div className="space-y-3">
        {track.modules.map((m, idx) => (
          <Card key={m.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-stone-400">#{idx + 1}</span>
                  <h3 className="font-medium text-stone-800">{m.title}</h3>
                  <span className="text-xs text-stone-400">
                    day {m.dayOffset} · {m.sendHourLocal}:00 local
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-stone-600">{m.bodyEs}</p>
                <div className="mt-2 rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
                  <span className="font-medium">Check:</span> {m.checkQuestionEs}
                  <ol className="mt-1 space-y-0.5">
                    {m.checkOptionsEs.map((o, i) => (
                      <li key={i} className={i === m.checkCorrectIndex ? 'font-semibold text-green-800' : ''}>
                        {i + 1}) {o} {i === m.checkCorrectIndex && '✓'}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => void move(idx, -1)} disabled={idx === 0}>↑</Button>
                  <Button variant="ghost" onClick={() => void move(idx, 1)} disabled={idx === track.modules.length - 1}>↓</Button>
                </div>
                <Button variant="ghost" onClick={() => openEditor(m)}>Edit</Button>
                <Button variant="ghost" onClick={() => void removeModule(m)}>Delete</Button>
              </div>
            </div>
          </Card>
        ))}
        {track.modules.length === 0 && (
          <Card className="p-8 text-center text-sm text-stone-400">
            No modules yet — add one by hand or generate drafts from an SOP.
          </Card>
        )}
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'Add module' : 'Edit module'} onClose={() => setEditing(null)} wide>
          <ErrorNote error={error} />
          <form onSubmit={(e) => void saveModule(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div>
                <Label>Day offset (days after enrollment)</Label>
                <Input
                  type="number" min={0} max={60} value={form.dayOffset}
                  onChange={(e) => setForm({ ...form, dayOffset: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Send hour (org local time)</Label>
                <Input
                  type="number" min={5} max={20} value={form.sendHourLocal}
                  onChange={(e) => setForm({ ...form, sendHourLocal: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <Label>Lesson body (Spanish, ≤900 chars, written for low literacy) — {form.bodyEs.length}/900</Label>
              <Textarea
                value={form.bodyEs} rows={7} maxLength={900} required
                onChange={(e) => setForm({ ...form, bodyEs: e.target.value })}
              />
            </div>
            <div>
              <Label>Check question (Spanish)</Label>
              <Input value={form.checkQuestionEs} onChange={(e) => setForm({ ...form, checkQuestionEs: e.target.value })} required />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {form.checkOptionsEs.map((o, i) => (
                <div key={i}>
                  <Label>
                    Option {i + 1}{' '}
                    <input
                      type="radio" name="correct" className="ml-1 align-middle"
                      checked={form.checkCorrectIndex === i}
                      onChange={() => setForm({ ...form, checkCorrectIndex: i })}
                    />{' '}
                    correct
                  </Label>
                  <Input
                    value={o} required
                    onChange={(e) => {
                      const opts = [...form.checkOptionsEs];
                      opts[i] = e.target.value;
                      setForm({ ...form, checkOptionsEs: opts });
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit">Save module</Button>
            </div>
          </form>
        </Modal>
      )}

      {generating && (
        <Modal title="Generate modules from an SOP" onClose={() => setGenerating(false)}>
          <ErrorNote error={error} />
          <p className="mb-3 text-sm text-stone-600">
            Claude drafts 3 modules (lesson + comprehension check) from the selected document.
            Review and edit them before enrolling anyone — you stay in control.
          </p>
          <Label>Source SOP</Label>
          <Select value={genDocId} onChange={(e) => setGenDocId(e.target.value)}>
            <option value="">Choose a document…</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </Select>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGenerating(false)}>Cancel</Button>
            <Button disabled={!genDocId || genBusy} onClick={() => void generate()}>
              {genBusy ? 'Drafting… (takes ~20s)' : 'Generate drafts'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
