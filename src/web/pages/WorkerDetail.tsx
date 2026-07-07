import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  CirclePause,
  FileText,
  Flag,
  GraduationCap,
  Hourglass,
  Mail,
  MessagesSquare,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { api, IS_DEMO } from '../api';
import { roleApplies, WORKER_ROLES } from '../../server/services/roles';
import {
  Badge,
  Button,
  Card,
  ConsentBadge,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
} from '../components';
import { useFmt, useT, type Dictionary } from '../i18n';

interface Delivery {
  id: string;
  moduleTitle: string;
  orderIndex: number;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  checkAnsweredAt: string | null;
  checkPassed: boolean | null;
}

interface EnrollmentDetail {
  id: string;
  trackName: string;
  status: string;
  startedAt: string;
  signedOffAt?: string | null;
  signedOffName?: string | null;
  signedOffRole?: string | null;
  certificateUrl: string | null;
  deliveries: Delivery[];
}

interface TrainingEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  topic: string;
  farmTopic?: string;
  questionText: string | null;
  answerText: string | null;
  confidence: string | null;
  sourceDocumentTitle: string | null;
}

interface AgreementStatus {
  signed: boolean;
  signedAt: string | null;
  version: number | null;
  method: 'whatsapp' | 'paper' | null;
  renewalDue: boolean;
  pendingSince: string | null;
}

interface WorkerDetailData {
  id: string;
  name: string;
  phoneE164: string;
  status: string;
  hiredAt: string | null;
  lastInboundAt: string | null;
  notes: string | null;
  jobRole?: string | null;
  alwaysAudio?: boolean;
  consentStatus?: string;
  consentedAt?: string | null;
  consentMethod?: string | null;
  consentAttestedBy?: string | null;
  deletedAt?: string | null;
  agreementStatus?: AgreementStatus | null;
  enrollments: EnrollmentDetail[];
  events: TrainingEvent[];
}

interface Track {
  id: string;
  name: string;
  moduleCount: number;
}

interface TrackModules {
  modules: Array<{ appliesToRoles: string[] | null }>;
}

const EVENT_STYLE: Record<string, { color: string; icon: LucideIcon }> = {
  qa_interaction: { color: 'blue', icon: MessagesSquare },
  module_delivered: { color: 'stone', icon: BookOpen },
  check_passed: { color: 'green', icon: CircleCheck },
  check_failed: { color: 'amber', icon: CircleAlert },
  escalation: { color: 'red', icon: Flag },
};

function eventLabel(t: Dictionary, eventType: string): string {
  return t.events[eventType as keyof Dictionary['events']] ?? eventType;
}

function farmLabel(t: Dictionary, farmTopic: string): string | undefined {
  return t.farm.short[farmTopic as keyof Dictionary['farm']['short']];
}

export default function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<WorkerDetailData | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [trackId, setTrackId] = useState('');
  const [trackPreview, setTrackPreview] = useState<{ applicable: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attesting, setAttesting] = useState<null | 'consent' | 'agreement'>(null);
  const [attestName, setAttestName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const t = useT();
  const { fmtDate, fmtDateTime, timeAgo } = useFmt();

  const load = useCallback(async () => {
    setData(await api<WorkerDetailData>(`/api/workers/${id}`));
  }, [id]);
  useEffect(() => {
    void load();
    void api<Track[]>('/api/tracks').then(setTracks);
  }, [load]);

  // Preview how many lessons this worker's role will actually receive from the
  // selected track (universal + role-specific that apply).
  useEffect(() => {
    if (!trackId) {
      setTrackPreview(null);
      return;
    }
    let cancelled = false;
    void api<TrackModules>(`/api/tracks/${trackId}`).then((track) => {
      if (cancelled) return;
      const applicable = track.modules.filter((m) =>
        roleApplies(m.appliesToRoles, data?.jobRole ?? null),
      ).length;
      setTrackPreview({ applicable, total: track.modules.length });
    });
    return () => {
      cancelled = true;
    };
  }, [trackId, data?.jobRole]);

  if (!data) return <Spinner />;

  async function enroll() {
    setError(null);
    try {
      await api(`/api/workers/${id}/enroll`, { method: 'POST', body: { trackId } });
      setEnrolling(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setRole(jobRole: string) {
    setError(null);
    try {
      await api(`/api/workers/${id}`, { method: 'PATCH', body: { jobRole: jobRole || null } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setAlwaysAudio(alwaysAudio: boolean) {
    setError(null);
    try {
      await api(`/api/workers/${id}`, { method: 'PATCH', body: { alwaysAudio } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendAgreement() {
    setError(null);
    setNote(null);
    try {
      const r = await api<{ outcome: string }>(`/api/workers/${id}/agreement/send`, {
        method: 'POST',
        body: {},
      });
      setNote(
        r.outcome === 'sent' ? t.workerDetail.agreementSentNote : t.workerDetail.agreementQueuedNote,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function attest() {
    setError(null);
    try {
      if (attesting === 'consent') {
        await api(`/api/workers/${id}/consent/paper`, {
          method: 'POST',
          body: { attestedBy: attestName.trim() },
        });
      } else {
        await api(`/api/workers/${id}/agreement/paper`, {
          method: 'POST',
          body: { attestedBy: attestName.trim() },
        });
      }
      setAttesting(null);
      setAttestName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function signOff(enrollmentId: string) {
    setError(null);
    try {
      await api(`/api/enrollments/${enrollmentId}/signoff`, { method: 'POST', body: {} });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteData() {
    setError(null);
    try {
      await api(`/api/workers/${id}/delete-data`, { method: 'POST', body: {} });
      setConfirmingDelete(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const consent = data.consentStatus ?? 'opted_in';
  const agr = data.agreementStatus;

  return (
    <div>
      <div className="mb-2 text-xs">
        <Link to="/workers" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t.nav.workers}
        </Link>
      </div>
      <PageHeader
        title={data.name}
        subtitle={
          <span>
            <span className="font-mono">{data.phoneE164}</span> · {t.workerDetail.hired}{' '}
            <span className="font-mono tabular-nums">{fmtDate(data.hiredAt)}</span> ·{' '}
            {t.workerDetail.lastActive} {timeAgo(data.lastInboundAt)}
          </span>
        }
        actions={
          data.deletedAt ? undefined : (
            <>
              {!IS_DEMO && (
                <a href={`/api/workers/${data.id}/transcript.pdf`}>
                  <Button variant="secondary">{t.workerDetail.downloadTranscript}</Button>
                </a>
              )}
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                {t.workerDetail.deleteData}
              </Button>
              <Button onClick={() => setEnrolling(true)}>{t.workerDetail.enrollInTrack}</Button>
            </>
          )
        }
      />
      <ErrorNote error={error} />
      {data.deletedAt && (
        <div className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t.workerDetail.deletedBefore} {fmtDate(data.deletedAt)}
          {t.workerDetail.deletedAfter}
        </div>
      )}
      {note && (
        <div className="badge-success mb-3 rounded-md border border-success/25 px-3 py-2 text-sm">
          {note}
        </div>
      )}

      {/* ── Job role (drives role-scoped onboarding) ── */}
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t.workerDetail.jobRoleTitle}</h2>
          <p className="text-xs text-muted-foreground">{t.workerDetail.jobRoleHint}</p>
        </div>
        <div className="w-64">
          <Select value={data.jobRole ?? ''} onChange={(e) => void setRole(e.target.value)}>
            <option value="">{t.workers.unassignedOption}</option>
            {WORKER_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {/* ── Voice replies (per-worker always-send-audio toggle) ── */}
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-64 flex-1">
          <h2 className="text-sm font-medium text-foreground">{t.workerDetail.voiceTitle}</h2>
          <p className="text-xs text-muted-foreground">{t.workerDetail.voiceHint}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={!!data.alwaysAudio}
            onChange={(e) => void setAlwaysAudio(e.target.checked)}
          />
          {data.alwaysAudio ? t.common.on : t.common.off}
        </label>
      </Card>

      {/* ── Compliance: consent + cow care agreement ── */}
      <Card className="mb-4 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1.5 text-sm font-medium text-foreground">
              {t.workerDetail.consentTitle}
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <ConsentBadge status={consent} />
              {data.consentedAt && (
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{fmtDate(data.consentedAt)}</span>
                  {data.consentMethod
                    ? ` · ${
                        t.consent.methods[data.consentMethod as keyof Dictionary['consent']['methods']] ??
                        data.consentMethod.replace(/_/g, ' ')
                      }`
                    : ''}
                  {data.consentAttestedBy
                    ? ` · ${t.workerDetail.attestedBy(data.consentAttestedBy)}`
                    : ''}
                </span>
              )}
            </div>
            {consent === 'pending' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">{t.workerDetail.consentPendingHint}</p>
                <Button variant="secondary" onClick={() => setAttesting('consent')}>
                  <PenLine aria-hidden="true" /> {t.workerDetail.consentPaperButton}
                </Button>
              </div>
            )}
            {consent === 'opted_out' && (
              <p className="mt-2 text-xs text-destructive">{t.workerDetail.optedOutNote}</p>
            )}
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-medium text-foreground">
              {t.workerDetail.agreementTitle}
            </h2>
            {agr?.signed ? (
              <div className="flex items-center gap-1.5 text-sm text-foreground">
                <CircleCheck className="size-4 text-success" aria-hidden="true" />
                <span>
                  {t.workerDetail.signed} <span className="font-mono">v{agr.version}</span>{' '}
                  {t.workerDetail.on}{' '}
                  <span className="font-mono tabular-nums">{fmtDate(agr.signedAt)}</span>{' '}
                  {t.workerDetail.via} {agr.method}
                </span>
                {agr.renewalDue && (
                  <span className="ml-1">
                    <Badge color="amber">{t.workerDetail.annualRenewalDue}</Badge>
                  </span>
                )}
              </div>
            ) : agr?.pendingSince ? (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Hourglass className="size-4" aria-hidden="true" />
                <span>
                  {t.workerDetail.sentPending}{' '}
                  <span className="font-mono tabular-nums">{fmtDateTime(agr.pendingSince)}</span>{' '}
                  {t.workerDetail.awaitingAcepto} <strong>ACEPTO</strong>
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t.workerDetail.notSigned}</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void sendAgreement()}
                disabled={consent !== 'opted_in'}
                title={consent !== 'opted_in' ? t.workerDetail.mustOptInFirst : undefined}
              >
                <Mail aria-hidden="true" />
                {agr?.signed ? t.workerDetail.sendForResignature : t.workerDetail.sendViaWhatsapp}
              </Button>
              <Button variant="secondary" onClick={() => setAttesting('agreement')}>
                <PenLine aria-hidden="true" /> {t.workerDetail.markSignedPaper}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t.workerDetail.farmAgreementNote}
            </p>
          </div>
        </div>
      </Card>

      {data.enrollments.length > 0 && (
        <div className="mb-4 space-y-3">
          {data.enrollments.map((enr) => (
            <Card key={enr.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{enr.trackName}</span>
                  <StatusBadge status={enr.status} />
                  {enr.status === 'completed' &&
                    (enr.signedOffAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <Check className="size-3.5" aria-hidden="true" />
                        {t.workerDetail.confirmedBy(enr.signedOffName ?? '', enr.signedOffRole ?? '')}{' '}
                        <span className="font-mono tabular-nums">{fmtDate(enr.signedOffAt)}</span>
                      </span>
                    ) : (
                      <Badge color="amber">{t.workerDetail.completionNotConfirmed}</Badge>
                    ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {t.workerDetail.started}{' '}
                    <span className="font-mono tabular-nums">{fmtDate(enr.startedAt)}</span>
                  </span>
                  {enr.status === 'completed' && !enr.signedOffAt && (
                    <Button onClick={() => void signOff(enr.id)}>
                      {t.workerDetail.confirmCompletion}
                    </Button>
                  )}
                  {enr.certificateUrl && (
                    <a
                      href={`${enr.certificateUrl}?download`}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <GraduationCap className="size-3.5" aria-hidden="true" />
                      {t.workerDetail.certificatePdf}
                    </a>
                  )}
                </div>
              </div>
              <ol className="space-y-1.5">
                {enr.deliveries.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {d.orderIndex + 1}.
                    </span>
                    <span className="flex-1 text-foreground">{d.moduleTitle}</span>
                    {d.checkPassed !== null &&
                      (d.checkPassed ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CircleCheck className="size-3.5" aria-hidden="true" />{' '}
                          {t.workerDetail.checkPassed}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-warning">
                          <CircleAlert className="size-3.5" aria-hidden="true" />{' '}
                          {t.workerDetail.checkMissed}
                        </span>
                      ))}
                    <StatusBadge status={d.status} />
                    <span className="w-36 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {d.sentAt
                        ? fmtDateTime(d.sentAt)
                        : t.workerDetail.due(fmtDateTime(d.scheduledFor))}
                    </span>
                  </li>
                ))}
              </ol>
              {enr.status === 'active' && consent === 'pending' && (
                <p className="badge-warning mt-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs">
                  <CirclePause className="size-3.5 shrink-0" aria-hidden="true" />
                  {t.workerDetail.awaitingOptInNote}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {t.workerDetail.transcriptTitle}{' '}
            <span className="font-normal text-muted-foreground">
              {t.workerDetail.transcriptSubtitle}
            </span>
          </h2>
        </div>
        {data.events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t.workerDetail.noEvents}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.events.map((ev) => {
              const style = EVENT_STYLE[ev.eventType] ?? EVENT_STYLE.qa_interaction;
              const Icon = style.icon;
              return (
                <li key={ev.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <Badge color={style.color}>{eventLabel(t, ev.eventType)}</Badge>
                    <Badge>{ev.topic}</Badge>
                    {ev.farmTopic && farmLabel(t, ev.farmTopic) && (
                      <Badge color="green">{farmLabel(t, ev.farmTopic)}</Badge>
                    )}
                    {ev.confidence && ev.confidence !== 'grounded' && (
                      <Badge color="amber">{ev.confidence}</Badge>
                    )}
                    <span className="ml-auto font-mono tabular-nums">{fmtDateTime(ev.occurredAt)}</span>
                  </div>
                  {ev.questionText && (
                    <p className="mt-1.5 text-sm font-medium text-foreground">"{ev.questionText}"</p>
                  )}
                  {ev.answerText && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{ev.answerText}</p>
                  )}
                  {ev.sourceDocumentTitle && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="size-3.5" aria-hidden="true" />
                      {ev.sourceDocumentTitle}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {confirmingDelete && (
        <Modal title={t.workerDetail.deleteTitle} onClose={() => setConfirmingDelete(false)}>
          <ErrorNote error={error} />
          <p className="mb-3 text-sm text-muted-foreground">
            {t.workerDetail.deleteBody1} <strong>{data.name}</strong>
            {t.workerDetail.deleteBody2}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void deleteData()}>
              {t.workerDetail.permanentlyDelete}
            </Button>
          </div>
        </Modal>
      )}

      {enrolling && (
        <Modal title={t.workerDetail.enrollTitle(data.name)} onClose={() => setEnrolling(false)}>
          <ErrorNote error={error} />
          <Label>{t.workerDetail.trackLabel}</Label>
          <Select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">{t.workerDetail.chooseTrack}</option>
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {t.workerDetail.trackOption(track.name, track.moduleCount)}
              </option>
            ))}
          </Select>
          {trackId && trackPreview && (
            <p className="mt-3 rounded-md bg-navactive-bg px-3 py-2 text-sm text-navactive-fg">
              {t.workerDetail.previewWorker}{' '}
              {data.jobRole ? (
                <>
                  ({t.workerDetail.previewRole}{' '}
                  <strong>{t.roles[data.jobRole as keyof Dictionary['roles']]}</strong>)
                </>
              ) : (
                t.workerDetail.previewUnassigned
              )}{' '}
              {t.workerDetail.previewReceive}{' '}
              <strong className="font-mono tabular-nums">
                {t.workerDetail.previewOf(trackPreview.applicable, trackPreview.total)}
              </strong>{' '}
              {t.workerDetail.previewLessons}
              {trackPreview.applicable === 0 && <> {t.workerDetail.previewNoneApply}</>}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t.workerDetail.scheduleNote}
            {consent !== 'opted_in' && <> {t.workerDetail.notOptedInNote}</>}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrolling(false)}>
              {t.common.cancel}
            </Button>
            <Button
              disabled={!trackId || trackPreview?.applicable === 0}
              onClick={() => void enroll()}
            >
              {t.workerDetail.enroll}
            </Button>
          </div>
        </Modal>
      )}

      {attesting && (
        <Modal
          title={
            attesting === 'consent'
              ? t.workerDetail.attestConsentTitle
              : t.workerDetail.attestAgreementTitle
          }
          onClose={() => setAttesting(null)}
        >
          <ErrorNote error={error} />
          <p className="mb-3 text-sm text-muted-foreground">
            {attesting === 'consent'
              ? t.workerDetail.attestConsentBody(data.name)
              : t.workerDetail.attestAgreementBody(data.name)}
          </p>
          <Label>{t.workerDetail.attestNameLabel}</Label>
          <Input
            value={attestName}
            onChange={(e) => setAttestName(e.target.value)}
            placeholder="Sarah Whitfield"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAttesting(null)}>
              {t.common.cancel}
            </Button>
            <Button disabled={attestName.trim().length < 2} onClick={() => void attest()}>
              {t.workerDetail.attest}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
