import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, IS_DEMO, timeAgo } from '../api';
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

const EVENT_STYLE: Record<string, { label: string; color: string; icon: string }> = {
  qa_interaction: { label: 'Q&A', color: 'blue', icon: '💬' },
  module_delivered: { label: 'Module delivered', color: 'stone', icon: '📚' },
  check_passed: { label: 'Check passed', color: 'green', icon: '✅' },
  check_failed: { label: 'Check missed', color: 'amber', icon: '✳️' },
  escalation: { label: 'Escalated', color: 'red', icon: '🚩' },
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
        <Link to="/workers" className="text-green-800 hover:underline">← Workers</Link>
      </div>
      <PageHeader
        title={data.name}
        subtitle={`${data.phoneE164} · hired ${fmtDate(data.hiredAt)} · last active ${timeAgo(data.lastInboundAt)}`}
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
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {note}
        </div>
      )}

      {/* ── Compliance: consent + cow care agreement ── */}
      <Card className="mb-4 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-1.5 text-sm font-semibold text-stone-700">WhatsApp consent</h2>
            <div className="flex items-center gap-2 text-sm">
              {consentBadge(consent)}
              {data.consentedAt && (
                <span className="text-xs text-stone-400">
                  {fmtDate(data.consentedAt)}
                  {data.consentMethod ? ` · ${data.consentMethod.replace(/_/g, ' ')}` : ''}
                  {data.consentAttestedBy ? ` · attested by ${data.consentAttestedBy}` : ''}
                </span>
              )}
            </div>
            {consent === 'pending' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-stone-500">
                  Establo sends nothing until this worker opts in: they text the number (ALTA or
                  any first message), or you collect the printed consent form and attest it here.
                </p>
                <Button variant="secondary" onClick={() => setAttesting('consent')}>
                  ✍️ Consent collected on paper
                </Button>
              </div>
            )}
            {consent === 'opted_out' && (
              <p className="mt-2 text-xs text-red-700">
                This worker texted BAJA. All sends are blocked until they text ALTA themselves —
                this cannot be overridden from the dashboard.
              </p>
            )}
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-semibold text-stone-700">Cow care agreement</h2>
            {agr?.signed ? (
              <div className="text-sm text-stone-700">
                ✅ Signed v{agr.version} on {fmtDate(agr.signedAt)} via {agr.method}
                {agr.renewalDue && (
                  <span className="ml-2">
                    <Badge color="amber">annual renewal due</Badge>
                  </span>
                )}
              </div>
            ) : agr?.pendingSince ? (
              <div className="text-sm text-stone-600">
                ⏳ Sent {fmtDateTime(agr.pendingSince)} — waiting for the worker to reply{' '}
                <strong>ACEPTO</strong>
              </div>
            ) : (
              <div className="text-sm text-stone-400">Not signed</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void sendAgreement()}
                disabled={consent !== 'opted_in'}
                title={consent !== 'opted_in' ? 'Worker must opt in first' : undefined}
              >
                {agr?.signed ? '📨 Send for re-signature' : '📨 Send via WhatsApp'}
              </Button>
              <Button variant="secondary" onClick={() => setAttesting('agreement')}>
                ✍️ Mark signed on paper
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-stone-400">
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
                <div>
                  <span className="font-medium text-stone-800">{enr.trackName}</span>
                  <span className="ml-2">{statusBadge(enr.status)}</span>
                  {enr.status === 'completed' &&
                    (enr.signedOffAt ? (
                      <span className="ml-2 text-xs text-green-700">
                        ✓ Confirmed by {enr.signedOffName} ({enr.signedOffRole}) on{' '}
                        {fmtDate(enr.signedOffAt)}
                      </span>
                    ) : (
                      <span className="ml-2">
                        <Badge color="amber">completion not confirmed</Badge>
                      </span>
                    ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-stone-400">
                  <span>started {fmtDate(enr.startedAt)}</span>
                  {enr.status === 'completed' && !enr.signedOffAt && (
                    <Button onClick={() => void signOff(enr.id)}>Confirm completion</Button>
                  )}
                  {enr.certificateUrl && (
                    <a
                      href={`${enr.certificateUrl}?download`}
                      className="font-medium text-green-800 hover:underline"
                    >
                      🎓 Certificate PDF
                    </a>
                  )}
                </div>
              </div>
              <ol className="space-y-1.5">
                {enr.deliveries.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-right text-xs text-stone-400">{d.orderIndex + 1}.</span>
                    <span className="flex-1 text-stone-700">{d.moduleTitle}</span>
                    {d.checkPassed !== null && (
                      <span className="text-xs">{d.checkPassed ? '✅ passed' : '✳️ missed'}</span>
                    )}
                    {statusBadge(d.status)}
                    <span className="w-32 text-right text-xs text-stone-400">
                      {d.sentAt ? fmtDateTime(d.sentAt) : `due ${fmtDateTime(d.scheduledFor)}`}
                    </span>
                  </li>
                ))}
              </ol>
              {enr.status === 'active' && consent === 'pending' && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⏸ Awaiting opt-in — lessons are scheduled but nothing is sent until this worker
                  opts in on WhatsApp.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="border-b border-stone-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-stone-700">
            Training transcript <span className="font-normal text-stone-400">— every logged event, newest first</span>
          </h2>
        </div>
        {data.events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-stone-400">No training events yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.events.map((ev) => {
              const style = EVENT_STYLE[ev.eventType] ?? EVENT_STYLE.qa_interaction;
              return (
                <li key={ev.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    <span>{style.icon}</span>
                    <Badge color={style.color}>{style.label}</Badge>
                    <Badge>{ev.topic}</Badge>
                    {ev.farmTopic && FARM_LABELS[ev.farmTopic] && (
                      <Badge color="green">{FARM_LABELS[ev.farmTopic]}</Badge>
                    )}
                    {ev.confidence && ev.confidence !== 'grounded' && (
                      <Badge color="amber">{ev.confidence}</Badge>
                    )}
                    <span className="ml-auto">{fmtDateTime(ev.occurredAt)}</span>
                  </div>
                  {ev.questionText && (
                    <p className="mt-1.5 text-sm font-medium text-stone-800">“{ev.questionText}”</p>
                  )}
                  {ev.answerText && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{ev.answerText}</p>
                  )}
                  {ev.sourceDocumentTitle && (
                    <p className="mt-1 text-xs text-stone-400">📄 {ev.sourceDocumentTitle}</p>
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
          <p className="mt-2 text-xs text-stone-400">
            Modules are scheduled from today using each module's day offset, and sent by the
            scheduler at the configured local hour.
            {consent !== 'opted_in' &&
              ' This worker has not opted in yet — nothing is sent until they do.'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrolling(false)}>Cancel</Button>
            <Button disabled={!trackId} onClick={() => void enroll()}>Enroll</Button>
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
          <p className="mb-3 text-sm text-stone-600">
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
