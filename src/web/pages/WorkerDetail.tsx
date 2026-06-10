import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, fmtDateTime, IS_DEMO, timeAgo } from '../api';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
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
  certificateUrl: string | null;
  deliveries: Delivery[];
}

interface TrainingEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  topic: string;
  questionText: string | null;
  answerText: string | null;
  confidence: string | null;
  sourceDocumentTitle: string | null;
}

interface WorkerDetailData {
  id: string;
  name: string;
  phoneE164: string;
  status: string;
  hiredAt: string | null;
  lastInboundAt: string | null;
  notes: string | null;
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

export default function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<WorkerDetailData | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [trackId, setTrackId] = useState('');
  const [error, setError] = useState<string | null>(null);

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

      {data.enrollments.length > 0 && (
        <div className="mb-4 space-y-3">
          {data.enrollments.map((enr) => (
            <Card key={enr.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-stone-800">{enr.trackName}</span>
                  <span className="ml-2">{statusBadge(enr.status)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-stone-400">
                  <span>started {fmtDate(enr.startedAt)}</span>
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
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrolling(false)}>Cancel</Button>
            <Button disabled={!trackId} onClick={() => void enroll()}>Enroll</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
