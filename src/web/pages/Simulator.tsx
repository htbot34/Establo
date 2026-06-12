import { useCallback, useEffect, useRef, useState } from 'react';
import { api, IS_DEMO, timeAgo } from '../api';
import { Button, Card, consentBadge, PageHeader, Select, Spinner } from '../components';

interface SimWorker {
  id: string;
  name: string;
  phoneE164: string;
  lastInboundAt: string | null;
  consentStatus?: string;
  pendingAgreement?: boolean;
}

interface Msg {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  bodyText: string | null;
  transcriptText: string | null;
  audioReplyUrl: string | null;
  createdAt: string;
}

interface ConversationData {
  lastInboundAt: string | null;
  messages: Msg[];
}

function windowOpen(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 3600_000;
}

export default function Simulator() {
  const [workers, setWorkers] = useState<SimWorker[] | null>(null);
  const [workerId, setWorkerId] = useState('');
  const [conv, setConv] = useState<ConversationData | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [sending, setSending] = useState(false);
  const [dripNote, setDripNote] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    void api<SimWorker[]>('/api/simulator/workers').then((w) => {
      setWorkers(w);
      if (w.length > 0) setWorkerId(w[0].id);
    });
  }, []);

  const poll = useCallback(async () => {
    if (!workerId) return;
    const data = await api<ConversationData>(`/api/simulator/conversation/${workerId}`);
    setConv(data);
  }, [workerId]);

  useEffect(() => {
    setConv(null);
    lastCount.current = 0;
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    const n = conv?.messages.length ?? 0;
    if (n > lastCount.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      lastCount.current = n;
    }
  }, [conv]);

  async function send() {
    if (!text.trim() || !workerId) return;
    setSending(true);
    try {
      await api('/api/simulator/inbound', {
        method: 'POST',
        body: { workerId, kind: mode, text: text.trim() },
      });
      setText('');
      setTimeout(() => void poll(), 600);
    } finally {
      setSending(false);
    }
  }

  async function runDrip() {
    const r = await api<{ delivered: number; notified: number; reminded: number }>(
      '/api/simulator/run-drip',
      { method: 'POST' },
    );
    setDripNote(`Scheduler ran: ${r.delivered} delivered, ${r.notified} notified, ${r.reminded} reminded`);
    setTimeout(() => setDripNote(''), 5000);
    void poll();
  }

  async function closeWindow() {
    await api('/api/simulator/close-window', { method: 'POST', body: { workerId } });
    setDripNote('Pretending the worker last wrote >24h ago — next drip uses the template handshake');
    setTimeout(() => setDripNote(''), 6000);
    void poll();
  }

  const worker = workers?.find((w) => w.id === workerId);
  const open = windowOpen(conv?.lastInboundAt ?? worker?.lastInboundAt ?? null);

  if (!workers) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="WhatsApp Simulator"
        subtitle="Mock mode only — play the role of a worker. Messages run through the real webhook pipeline."
      />
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-2 space-y-3">
          <Card className="p-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">Acting as worker</label>
            <Select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.phoneE164})
                </option>
              ))}
            </Select>
            <div className="mt-3 text-xs text-stone-500">
              24h window:{' '}
              {open ? (
                <span className="font-semibold text-green-700">OPEN</span>
              ) : (
                <span className="font-semibold text-red-600">CLOSED</span>
              )}{' '}
              — last inbound {timeAgo(conv?.lastInboundAt ?? worker?.lastInboundAt)}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-500">
              Consent: {consentBadge(worker?.consentStatus)}
              {worker?.pendingAgreement && (
                <span className="text-amber-700">📋 agreement awaiting ACEPTO</span>
              )}
            </div>
          </Card>
          <Card className="space-y-2 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
              Scheduler controls
            </h3>
            <Button variant="secondary" className="w-full" onClick={() => void runDrip()}>
              ⏰ Run drip scheduler now
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => void closeWindow()}>
              🕐 Simulate &gt;24h since last message
            </Button>
            {dripNote && <p className="text-xs font-medium text-green-700">{dripNote}</p>}
            <p className="text-xs text-stone-400">
              Enroll this worker in a track (Workers page), close the window, then run the
              scheduler to watch the template handshake: notify template → worker replies OK →
              full lesson arrives.
            </p>
          </Card>
        </div>

        <div className="col-span-3">
          <div className="overflow-hidden rounded-[2rem] border-8 border-stone-800 bg-stone-800 shadow-xl">
            <div className="flex items-center gap-2 bg-emerald-800 px-4 py-3 text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
                E
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">Establo</div>
                <div className="text-[10px] text-emerald-200">asistente de capacitación</div>
              </div>
            </div>
            <div
              ref={scrollRef}
              className="h-[26rem] space-y-1.5 overflow-y-auto bg-[#e5ddd5] px-3 py-3"
            >
              {!conv ? (
                <Spinner />
              ) : conv.messages.length === 0 ? (
                <p className="pt-10 text-center text-xs text-stone-500">
                  No hay mensajes. Escribe abajo como si fueras {worker?.name}.
                </p>
              ) : (
                conv.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] shadow ${
                        m.direction === 'inbound' ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white'
                      }`}
                    >
                      {m.type === 'voice' && m.direction === 'inbound' && (
                        <div className="mb-0.5 text-[10px] text-stone-500">🎤 nota de voz (transcrita)</div>
                      )}
                      {m.type === 'template' && (
                        <div className="mb-0.5 text-[10px] text-stone-500">📋 plantilla (fuera de ventana 24h)</div>
                      )}
                      <p className="whitespace-pre-wrap">{m.bodyText ?? m.transcriptText ?? ''}</p>
                      {m.audioReplyUrl &&
                        (IS_DEMO ? (
                          <div className="mt-1 w-fit rounded-full bg-stone-100 px-2.5 py-1 text-[10px] text-stone-500">
                            🔊 respuesta de voz — silenciada en este demo (el sistema real envía audio TTS)
                          </div>
                        ) : (
                          <div className="mt-1">
                            <div className="mb-0.5 text-[10px] text-stone-500">🔊 respuesta de voz (TTS)</div>
                            <audio controls src={m.audioReplyUrl} className="h-8 w-48" />
                          </div>
                        ))}
                      <div className="mt-0.5 text-right text-[9px] text-stone-400">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {m.direction === 'outbound' && ' ✓✓'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 bg-stone-100 px-3 py-2.5">
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => setMode('text')}
                  className={`rounded-full px-3 py-1 font-medium ${mode === 'text' ? 'bg-emerald-700 text-white' : 'bg-white text-stone-600'}`}
                >
                  💬 Texto
                </button>
                <button
                  onClick={() => setMode('voice')}
                  className={`rounded-full px-3 py-1 font-medium ${mode === 'voice' ? 'bg-emerald-700 text-white' : 'bg-white text-stone-600'}`}
                >
                  🎤 Nota de voz
                </button>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={mode === 'voice' ? 2 : 1}
                  placeholder={
                    mode === 'voice'
                      ? 'Escribe lo que el trabajador DIRÍA en su nota de voz…'
                      : 'Escribe un mensaje…'
                  }
                  className="flex-1 resize-none rounded-full border border-stone-300 bg-white px-4 py-2 text-sm focus:outline-none"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !text.trim()}
                  className="h-10 w-10 shrink-0 self-end rounded-full bg-emerald-700 text-white disabled:bg-stone-300"
                >
                  ➤
                </button>
              </div>
              <p className="text-[10px] text-stone-400">
                Prueba: “¿qué hago si una vaca tiene mastitis?” · “¿cuánto tiempo dejo el pre-dip?” ·
                “¿me puedes subir el sueldo?” · “hola” · con una lección pendiente responde “2” ·
                consentimiento: “ALTA” (alta + aviso de privacidad) / “BAJA” (baja) · con un acuerdo
                pendiente responde “ACEPTO” (firma)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
