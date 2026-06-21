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
import { api, fmtDate, fmtDateTime, IS_DEMO, timeAgo } from '../api';
import { roleApplies, WORKER_ROLES, WORKER_ROLE_LABELS } from '../../server/services/roles';
import {
  Badge,
  Button,
  Card,
  consentBadge,
  ErrorNote,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Spinner,
  statusBadge,
} from '../components';

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
  consentStatus?: string;
  consentedAt?: string | null;
  consentMethod?: string | null;
  consentAttestedBy?: string | null;
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

const EVENT_STYLE: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  qa_interaction: { label: 'Q&A', color: 'blue', icon: MessagesSquare },
  module_delivered: { label: 'Module delivered', color: 'stone', icon: BookOpen },
  check_passed: { label: 'Check passed', color: 'green', icon: CircleCheck },
  check_failed: { label: 'Check missed', color: 'amber', icon: CircleAlert },
  escalation: { label: 'Escalated', color: 'red', icon: Flag },
};

const FARM_LABELS: Record<string, string> = {
  stockmanship_general: 'FARM: stockmanship',
  preweaned_calf: 'FARM: calf care',
  non_ambulatory: 'FARM: non-ambulatory',
  euthanasia: 'FARM: euthanasia',
  fitness_to_transport: 'FARM: transport',
  safety_other: 'safety',
};

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
  const [note, setNote] = useState<string | null>(null);

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
    void api<TrackModules>(`/api/tracks/${trackId}`).then((t) => {
      if (cancelled) return;
      const applicable = t.modules.filter((m) =>
        roleApplies(m.appliesToRoles, data?.jobRole ?? null),
      ).length;
      setTrackPreview({ applicable, total: t.modules.length });
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

  async function sendAgreement() {
    setError(null);
    setNote(null);
    try {
      const r = await api<{ outcome: string }>(`/api/workers/${id}/agreement/send`, {
        method: 'POST',
        body: {},
      });
      setNote(
        r.outcome === 'sent'
          ? 'Agreement sent — the worker signs by replying ACEPTO.'
          : 'Agreement queued — it goes out the next time the worker writes (24h window is closed).',
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

  const consent = data.consentStatus ?? 'opted_in';
  const agr = data.agreementStatus;

  return (
    <div>
      <div className="mb-2 text-xs">
        <Link to="/workers" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Workers
        </Link>
      </div>
      <PageHeader
        title={data.name}
        subtitle={
          <span>
            <span className="font-mono">{data.phoneE164}</span> · hired{' '}
            <span className="font-mono tabular-nums">{fmtDate(data.hiredAt)}</span> · last active{' '}
            {timeAgo(data.lastInboundAt)}
          </span>
        }
        actions={
          <>
            {!IS_DEMO && (
              <a href={`/api/workers/${data.id}/transcript.pdf`}>
                <Button variant="secondary">Download transcript PDF</Button>
              </a>
            )}
            <Button onClick={() => setEnrolling(true)}>Enroll in track</Button>
          </>
        }
      />
      <ErrorNote error={error} />
      {note && (
        <div className="badge-success mb-3 rounded-md border border-success/25 px-3 py-2 text-sm">
          {note}
        </div>
      )}

      {/* ── Job role (drives role-scoped onboarding) ── */}
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">Job role</h2>
          <p className="text-xs text-muted-foreground">
            Decides which role-specific lessons this worker receives when enrolled.
          </p>
        </div>
        <div className="w-64">
          <Select value={data.jobRole ?? ''} onChange={(e) => void setRole(e.target.value)}>
            <option value="">Unassigned (universal lessons only)</option>
            {WORKER_ROLES.map((r) => (
              <option key={r} value={r}>
                {WORKER_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {/* ── Compliance: consent + cow care agreement ── */}
      <Card className="mb-4 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1.5 text-sm font-medium text-foreground">WhatsApp consent</h2>
            <div className="flex items-center gap-2 text-sm">
              {consentBadge(consent)}
              {data.consentedAt && (
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{fmtDate(data.consentedAt)}</span>
                  {data.consentMethod ? ` · ${data.consentMethod.replace(/_/g, ' ')}` : ''}
                  {data.consentAttestedBy ? ` · attested by ${data.consentAttestedBy}` : ''}
                </span>
              )}
            </div>
            {consent === 'pending' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Establo sends nothing until this worker opts in: they text the number (ALTA or
                  any first message), or you collect the printed consent form and attest it here.
                </p>
                <Button variant="secondary" onClick={() => setAttesting('consent')}>
                  <PenLine aria-hidden="true" /> Consent collected on paper
                </Button>
              </div>
            )}
            {consent === 'opted_out' && (
              <p className="mt-2 text-xs text-destructive">
                This worker texted BAJA. All sends are blocked until they text ALTA themselves —
                this cannot be overridden from the dashboard.
              </p>
            )}
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-medium text-foreground">Cow care agreement</h2>
            {agr?.signed ? (
              <div className="flex items-center gap-1.5 text-sm text-foreground">
                <CircleCheck className="size-4 text-success" aria-hidden="true" />
                <span>
                  Signed <span className="font-mono">v{agr.version}</span> on{' '}
                  <span className="font-mono tabular-nums">{fmtDate(agr.signedAt)}</span> via{' '}
                  {agr.method}
                </span>
                {agr.renewalDue && (
                  <span className="ml-1">
                    <Badge color="amber">annual renewal due</Badge>
                  </span>
                )}
              </div>
            ) : agr?.pendingSince ? (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Hourglass className="size-4" aria-hidden="true" />
                <span>
                  Sent <span className="font-mono tabular-nums">{fmtDateTime(agr.pendingSince)}</span>{' '}
                  — waiting for the worker to reply <strong>ACEPTO</strong>
                </span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Not signed</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void sendAgreement()}
                disabled={consent !== 'opted_in'}
                title={consent !== 'opted_in' ? 'Worker must opt in first' : undefined}
              >
                <Mail aria-hidden="true" />
                {agr?.signed ? 'Send for re-signature' : 'Send via WhatsApp'}
              </Button>
              <Button variant="secondary" onClick={() => setAttesting('agreement')}>
                <PenLine aria-hidden="true" /> Mark signed on paper
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              FARM Animal Care v5 expects a signed cow care agreement for every employee with
              animal care responsibilities, renewed annually.
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
                  {statusBadge(enr.status)}
                  {enr.status === 'completed' &&
                    (enr.signedOffAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <Check className="size-3.5" aria-hidden="true" />
                        Confirmed by {enr.signedOffName} ({enr.signedOffRole}) on{' '}
                        <span className="font-mono tabular-nums">{fmtDate(enr.signedOffAt)}</span>
                      </span>
                    ) : (
                      <Badge color="amber">completion not confirmed</Badge>
                    ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    started{' '}
                    <span className="font-mono tabular-nums">{fmtDate(enr.startedAt)}</span>
                  </span>
                  {enr.status === 'completed' && !enr.signedOffAt && (
                    <Button onClick={() => void signOff(enr.id)}>Confirm completion</Button>
                  )}
                  {enr.certificateUrl && (
                    <a
                      href={`${enr.certificateUrl}?download`}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <GraduationCap className="size-3.5" aria-hidden="true" />
                      Certificate PDF
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
                          <CircleCheck className="size-3.5" aria-hidden="true" /> passed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-warning">
                          <CircleAlert className="size-3.5" aria-hidden="true" /> missed
                        </span>
                      ))}
                    {statusBadge(d.status)}
                    <span className="w-36 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {d.sentAt ? fmtDateTime(d.sentAt) : `due ${fmtDateTime(d.scheduledFor)}`}
                    </span>
                  </li>
                ))}
              </ol>
              {enr.status === 'active' && consent === 'pending' && (
                <p className="badge-warning mt-3 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs">
                  <CirclePause className="size-3.5 shrink-0" aria-hidden="true" />
                  Awaiting opt-in — lessons are scheduled but nothing is sent until this worker opts
                  in on WhatsApp.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-foreground">
            Training transcript{' '}
            <span className="font-normal text-muted-foreground">— every logged event, newest first</span>
          </h2>
        </div>
        {data.events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No training events yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.events.map((ev) => {
              const style = EVENT_STYLE[ev.eventType] ?? EVENT_STYLE.qa_interaction;
              const Icon = style.icon;
              return (
                <li key={ev.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <Badge color={style.color}>{style.label}</Badge>
                    <Badge>{ev.topic}</Badge>
                    {ev.farmTopic && FARM_LABELS[ev.farmTopic] && (
                      <Badge color="green">{FARM_LABELS[ev.farmTopic]}</Badge>
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

      {enrolling && (
        <Modal title={`Enroll ${data.name}`} onClose={() => setEnrolling(false)}>
          <ErrorNote error={error} />
          <Label>Onboarding track</Label>
          <Select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">Choose a track…</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.moduleCount} modules)
              </option>
            ))}
          </Select>
          {trackId && trackPreview && (
            <p className="mt-3 rounded-md bg-navactive-bg px-3 py-2 text-sm text-navactive-fg">
              This worker{' '}
              {data.jobRole ? (
                <>
                  (role: <strong>{WORKER_ROLE_LABELS[data.jobRole as keyof typeof WORKER_ROLE_LABELS]}</strong>)
                </>
              ) : (
                '(unassigned)'
              )}{' '}
              will receive{' '}
              <strong className="font-mono tabular-nums">
                {trackPreview.applicable} of {trackPreview.total}
              </strong>{' '}
              lessons based on their role.
              {trackPreview.applicable === 0 &&
                ' No lessons in this track apply to this role — assign a different role or pick another track.'}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Modules are scheduled from today using each module's day offset, and sent by the
            scheduler at the configured local hour.
            {consent !== 'opted_in' &&
              ' This worker has not opted in yet — nothing is sent until they do.'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrolling(false)}>Cancel</Button>
            <Button
              disabled={!trackId || trackPreview?.applicable === 0}
              onClick={() => void enroll()}
            >
              Enroll
            </Button>
          </div>
        </Modal>
      )}

      {attesting && (
        <Modal
          title={
            attesting === 'consent'
              ? 'Consent collected on paper'
              : 'Agreement signed on paper'
          }
          onClose={() => setAttesting(null)}
        >
          <ErrorNote error={error} />
          <p className="mb-3 text-sm text-muted-foreground">
            {attesting === 'consent'
              ? `Confirm that ${data.name} signed the printed WhatsApp-consent form. Keep the paper form in their file.`
              : `Confirm that ${data.name} signed the cow care agreement on paper. Keep the signed copy in their file.`}
          </p>
          <Label>Your full name (attestation)</Label>
          <Input
            value={attestName}
            onChange={(e) => setAttestName(e.target.value)}
            placeholder="Sarah Whitfield"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAttesting(null)}>Cancel</Button>
            <Button disabled={attestName.trim().length < 2} onClick={() => void attest()}>
              Attest
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
