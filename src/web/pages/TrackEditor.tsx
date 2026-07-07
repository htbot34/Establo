import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Sparkles, Video } from 'lucide-react';
import { api } from '../api';
import { WORKER_ROLES } from '../../server/services/roles';
import { parseVideoUrl } from '../../server/services/video';
import { VIDEO_CATALOG } from '../../server/services/videoCatalog';
import {
  Badge,
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
import { useT, type Dictionary } from '../i18n';

interface ModuleRow {
  id: string;
  orderIndex: number;
  dayOffset: number;
  sendHourLocal: number;
  farmTopic?: string;
  appliesToRoles?: string[] | null;
  videoUrl?: string | null;
  videoTitleEs?: string | null;
  videoLangs?: string[] | null;
  videoAttribution?: string | null;
  title: string;
  bodyEs: string;
  checkQuestionEs: string;
  checkOptionsEs: string[];
  checkCorrectIndex: number;
}

const VIDEO_LANGS = ['es', 'en'] as const;

/** FARM Animal Care v5 continuing-education areas (audit pack groups by these). */
const FARM_TOPIC_VALUES = [
  'none',
  'stockmanship_general',
  'preweaned_calf',
  'non_ambulatory',
  'euthanasia',
  'fitness_to_transport',
  'safety_other',
] as const;

function farmShort(t: Dictionary, topic: string): string {
  return t.farm.short[topic as keyof Dictionary['farm']['short']] ?? topic;
}

function roleShort(t: Dictionary, role: string): string {
  return t.rolesShort[role as keyof Dictionary['rolesShort']] ?? role;
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
  farmTopic: 'none',
  appliesToRoles: [] as string[],
  videoUrl: '',
  videoTitleEs: '',
  videoLangs: [] as string[],
  videoAttribution: '',
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
  const t = useT();

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
            farmTopic: mod.farmTopic ?? 'none',
            appliesToRoles: [...(mod.appliesToRoles ?? [])],
            videoUrl: mod.videoUrl ?? '',
            videoTitleEs: mod.videoTitleEs ?? '',
            videoLangs: [...(mod.videoLangs ?? [])],
            videoAttribution: mod.videoAttribution ?? '',
          },
    );
  }

  /**
   * Fill the video fields from a curated catalog entry. Role targeting and the
   * FARM topic are pre-filled from the entry's suggestions ONLY when the manager
   * hasn't set them yet (empty roles / 'none' topic) — never clobbering a choice.
   */
  function applyCatalog(key: string) {
    const v = VIDEO_CATALOG.find((c) => c.key === key);
    if (!v) return;
    setForm((f) => ({
      ...f,
      videoUrl: v.url,
      videoTitleEs: v.titleEs,
      videoLangs: [...v.langs],
      videoAttribution: v.attribution,
      appliesToRoles: f.appliesToRoles.length === 0 ? [...v.suggestedRoles] : f.appliesToRoles,
      farmTopic: f.farmTopic === 'none' ? v.suggestedFarmTopic : f.farmTopic,
    }));
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
    if (!window.confirm(t.trackEditor.confirmDeleteModule(m.title))) return;
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
        <Link
          to="/onboarding"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t.nav.onboarding}
        </Link>
      </div>
      <PageHeader
        title={track.name}
        subtitle={track.description ?? undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => { setError(null); setGenerating(true); }}>
              <Sparkles aria-hidden="true" /> {t.trackEditor.generateFromSop}
            </Button>
            <Button onClick={() => openEditor('new')}>{t.trackEditor.addModule}</Button>
          </>
        }
      />
      <ErrorNote error={generating || editing ? null : error} />

      <div className="space-y-3">
        {track.modules.map((m, idx) => (
          <Card key={m.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    #{idx + 1}
                  </span>
                  <h3 className="font-medium text-foreground">{m.title}</h3>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {t.trackEditor.dayAt(m.dayOffset, m.sendHourLocal)}
                  </span>
                  {m.farmTopic && m.farmTopic !== 'none' && (
                    <Badge color="green">{farmShort(t, m.farmTopic)}</Badge>
                  )}
                  {!m.appliesToRoles || m.appliesToRoles.length === 0 ? (
                    <Badge color="blue">{t.trackEditor.allRoles}</Badge>
                  ) : (
                    m.appliesToRoles.map((r) => (
                      <Badge key={r} color="blue">
                        {roleShort(t, r)}
                      </Badge>
                    ))
                  )}
                  {m.videoUrl && (
                    <Badge color="stone">
                      <span className="inline-flex items-center gap-1">
                        <Video className="size-3" aria-hidden="true" /> {t.trackEditor.videoTag}
                      </span>
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{m.bodyEs}</p>
                <div className="mt-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t.trackEditor.checkLabel}</span>{' '}
                  {m.checkQuestionEs}
                  <ol className="mt-1 space-y-0.5">
                    {m.checkOptionsEs.map((o, i) => (
                      <li
                        key={i}
                        className={
                          i === m.checkCorrectIndex
                            ? 'flex items-center gap-1.5 font-medium text-success'
                            : 'flex items-center gap-1.5'
                        }
                      >
                        <span className="font-mono tabular-nums">{i + 1})</span> {o}
                        {i === m.checkCorrectIndex && (
                          <Check className="size-3.5" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex gap-1">
                  <Button variant="ghost" aria-label={t.trackEditor.moveUp} onClick={() => void move(idx, -1)} disabled={idx === 0}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={t.trackEditor.moveDown}
                    onClick={() => void move(idx, 1)}
                    disabled={idx === track.modules.length - 1}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </div>
                <Button variant="ghost" onClick={() => openEditor(m)}>{t.common.edit}</Button>
                <Button variant="ghost" onClick={() => void removeModule(m)}>{t.common.delete}</Button>
              </div>
            </div>
          </Card>
        ))}
        {track.modules.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {t.trackEditor.emptyNote}
          </Card>
        )}
      </div>

      {editing && (
        <Modal
          title={editing === 'new' ? t.trackEditor.addTitle : t.trackEditor.editTitle}
          onClose={() => setEditing(null)}
          wide
        >
          <ErrorNote error={error} />
          <form onSubmit={(e) => void saveModule(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{t.trackEditor.titleLabel}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div>
                <Label>{t.trackEditor.dayOffsetLabel}</Label>
                <Input
                  type="number" min={0} max={60} value={form.dayOffset}
                  onChange={(e) => setForm({ ...form, dayOffset: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>{t.trackEditor.sendHourLabel}</Label>
                <Input
                  type="number" min={5} max={20} value={form.sendHourLocal}
                  onChange={(e) => setForm({ ...form, sendHourLocal: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2">
                <Label>{t.trackEditor.farmAreaLabel}</Label>
                <Select
                  value={form.farmTopic}
                  onChange={(e) => setForm({ ...form, farmTopic: e.target.value })}
                >
                  {FARM_TOPIC_VALUES.map((value) => (
                    <option key={value} value={value}>{t.farm.options[value]}</option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Label>{t.trackEditor.rolesLabel}</Label>
                <div className="flex flex-wrap gap-3 rounded-md border border-border p-2.5">
                  {WORKER_ROLES.map((r) => {
                    const checked = form.appliesToRoles.includes(r);
                    return (
                      <label key={r} className="flex items-center gap-1.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className="rounded border-input"
                          checked={checked}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              appliesToRoles: e.target.checked
                                ? [...form.appliesToRoles, r]
                                : form.appliesToRoles.filter((x) => x !== r),
                            })
                          }
                        />
                        {t.roles[r]}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.appliesToRoles.length === 0
                    ? t.trackEditor.universalNote
                    : t.trackEditor.onlyRolesNote(
                        form.appliesToRoles.map((r) => roleShort(t, r)).join(', '),
                      )}
                </p>
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <Label>{t.trackEditor.videoSectionLabel}</Label>
              <Select
                className="mb-2"
                value={VIDEO_CATALOG.find((c) => c.url === form.videoUrl)?.key ?? ''}
                onChange={(e) => applyCatalog(e.target.value)}
              >
                <option value="">{t.trackEditor.chooseFromLibrary}</option>
                {VIDEO_CATALOG.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.titleEs} — {c.series}
                  </option>
                ))}
              </Select>
              <Input
                placeholder={t.trackEditor.videoUrlPlaceholder}
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
              />
              {form.videoUrl && !parseVideoUrl(form.videoUrl) && (
                <p className="mt-1 text-xs text-destructive">{t.trackEditor.invalidVideoLink}</p>
              )}
              {form.videoUrl && parseVideoUrl(form.videoUrl) && (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t.trackEditor.videoTitleLabel}</Label>
                      <Input
                        value={form.videoTitleEs}
                        placeholder={form.title || t.trackEditor.videoTitleFallback}
                        onChange={(e) => setForm({ ...form, videoTitleEs: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t.trackEditor.availableLanguages}</Label>
                      <div className="flex gap-3 pt-2">
                        {VIDEO_LANGS.map((lang) => (
                          <label key={lang} className="flex items-center gap-1.5 text-sm text-foreground">
                            <input
                              type="checkbox"
                              className="rounded border-input"
                              checked={form.videoLangs.includes(lang)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  videoLangs: e.target.checked
                                    ? [...form.videoLangs, lang]
                                    : form.videoLangs.filter((x) => x !== lang),
                                })
                              }
                            />
                            {lang.toUpperCase()}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label>{t.trackEditor.attributionLabel}</Label>
                    <Textarea
                      value={form.videoAttribution}
                      rows={2}
                      maxLength={400}
                      placeholder="«Título» — producido por… Usado con autorización."
                      onChange={(e) => setForm({ ...form, videoAttribution: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.trackEditor.attributionHint}
                    </p>
                  </div>
                  {parseVideoUrl(form.videoUrl)?.embedUrl ? (
                    <div className="mt-2 aspect-video w-full max-w-md overflow-hidden rounded-md border border-border">
                      <iframe
                        src={parseVideoUrl(form.videoUrl)!.embedUrl!}
                        title={t.trackEditor.videoPreview}
                        className="h-full w-full"
                        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.trackEditor.linkNoPreview}
                    </p>
                  )}
                  {form.videoAttribution.trim() && (
                    <p className="mt-1.5 text-xs italic text-muted-foreground">
                      ℹ️ {form.videoAttribution}
                    </p>
                  )}
                </>
              )}
            </div>
            <div>
              <Label>
                {t.trackEditor.bodyLabel}{' '}
                <span className="font-mono tabular-nums">{form.bodyEs.length}/900</span>
              </Label>
              <Textarea
                value={form.bodyEs} rows={7} maxLength={900} required
                onChange={(e) => setForm({ ...form, bodyEs: e.target.value })}
              />
            </div>
            <div>
              <Label>{t.trackEditor.checkQuestionLabel}</Label>
              <Input value={form.checkQuestionEs} onChange={(e) => setForm({ ...form, checkQuestionEs: e.target.value })} required />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {form.checkOptionsEs.map((o, i) => (
                <div key={i}>
                  <Label>
                    {t.trackEditor.optionLabel(i + 1)}{' '}
                    <input
                      type="radio" name="correct" className="ml-1 align-middle"
                      checked={form.checkCorrectIndex === i}
                      onChange={() => setForm({ ...form, checkCorrectIndex: i })}
                    />{' '}
                    {t.trackEditor.correct}
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
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
              <Button type="submit">{t.trackEditor.saveModule}</Button>
            </div>
          </form>
        </Modal>
      )}

      {generating && (
        <Modal title={t.trackEditor.generateTitle} onClose={() => setGenerating(false)}>
          <ErrorNote error={error} />
          <p className="mb-3 text-sm text-muted-foreground">{t.trackEditor.generateBody}</p>
          <Label>{t.trackEditor.sourceSop}</Label>
          <Select value={genDocId} onChange={(e) => setGenDocId(e.target.value)}>
            <option value="">{t.trackEditor.chooseDocument}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </Select>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGenerating(false)}>{t.common.cancel}</Button>
            <Button disabled={!genDocId || genBusy} onClick={() => void generate()}>
              {genBusy ? t.trackEditor.drafting : t.trackEditor.generateDrafts}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
