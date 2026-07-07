import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCheck, ClipboardList, Clock, History, Mic, MessagesSquare, Send, Volume2 } from 'lucide-react';
import { api, IS_DEMO } from '../api';
import { Badge, Button, Card, ConsentBadge, PageHeader, Select, Spinner } from '../components';
import { useFmt, useT } from '../i18n';
import { looksSpanish } from '../../server/services/language';
import { videoFromText } from '../../server/services/video';

/**
 * Spanish starter questions drawn from the seeded SOPs (tap to fill the box).
 * Worker-facing content: everything INSIDE the WhatsApp phone frame stays
 * Spanish in both dashboard languages — it mirrors what the worker sees.
 */
const SUGGESTED_QUESTIONS = [
  '¿qué hago si una vaca tiene mastitis?',
  '¿cuánto tiempo dejo el pre-dip?',
  '¿cuántos chorros saco en el despunte?',
  '¿cuánto calostro le doy a una becerra recién nacida?',
  '¿qué pasa si mezclo cloro con ácido?',
  '¿qué hago con una vaca que se cayó y no se para?',
];

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
  // Reviewer-facing nudge: set when the last message a reviewer sent wasn't
  // Spanish, so they understand why the worker assistant answered in Spanish.
  const [nonSpanishHint, setNonSpanishHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const t = useT();
  const { timeAgo } = useFmt();

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
    setNonSpanishHint(false);
    lastCount.current = 0;
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => clearInterval(timer);
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
    const outgoing = text.trim();
    setSending(true);
    try {
      await api('/api/simulator/inbound', {
        method: 'POST',
        body: { workerId, kind: mode, text: outgoing },
      });
      // The worker assistant only answers in Spanish; surface that to the
      // (English-speaking) reviewer when they just typed something else.
      setNonSpanishHint(!looksSpanish(outgoing));
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
    setDripNote(t.simulator.dripRan(r.delivered, r.notified, r.reminded));
    setTimeout(() => setDripNote(''), 5000);
    void poll();
  }

  async function closeWindow() {
    await api('/api/simulator/close-window', { method: 'POST', body: { workerId } });
    setDripNote(t.simulator.windowClosedNote);
    setTimeout(() => setDripNote(''), 6000);
    void poll();
  }

  const worker = workers?.find((w) => w.id === workerId);
  const open = windowOpen(conv?.lastInboundAt ?? worker?.lastInboundAt ?? null);

  if (!workers) return <Spinner />;

  return (
    <div>
      <PageHeader
        title={t.simulator.title}
        subtitle={t.simulator.subtitle}
        actions={<Badge color="amber">{t.simulator.mockBadge}</Badge>}
      />
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-2 space-y-3">
          <Card className="p-4">
            <label className="mb-1 block text-xs font-medium text-secondary-foreground">
              {t.simulator.actingAs}
            </label>
            <Select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.phoneE164})
                </option>
              ))}
            </Select>
            <div className="mt-3 text-xs text-muted-foreground">
              {t.simulator.windowLabel}{' '}
              {open ? (
                <span className="font-semibold text-success">{t.simulator.windowOpen}</span>
              ) : (
                <span className="font-semibold text-destructive">{t.simulator.windowClosed}</span>
              )}{' '}
              {t.simulator.lastInbound} {timeAgo(conv?.lastInboundAt ?? worker?.lastInboundAt)}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              {t.simulator.consentLabel} <ConsentBadge status={worker?.consentStatus} />
              {worker?.pendingAgreement && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <ClipboardList className="size-3.5" aria-hidden="true" />{' '}
                  {t.simulator.agreementAwaiting}
                </span>
              )}
            </div>
          </Card>
          <Card className="space-y-2 p-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.simulator.schedulerControls}
            </h3>
            <Button variant="secondary" className="w-full justify-start" onClick={() => void runDrip()}>
              <Clock aria-hidden="true" /> {t.simulator.runDrip}
            </Button>
            <Button variant="secondary" className="w-full justify-start" onClick={() => void closeWindow()}>
              <History aria-hidden="true" /> {t.simulator.closeWindow}
            </Button>
            {dripNote && <p className="text-xs font-medium text-success">{dripNote}</p>}
            <p className="text-xs text-muted-foreground">{t.simulator.handshakeHint}</p>
          </Card>
        </div>

        <div className="col-span-3">
          {/* Authentic WhatsApp chrome: fixed device + WhatsApp colors, theme-independent.
              The content inside the frame is what the WORKER sees — always Spanish. */}
          <div className="overflow-hidden rounded-[2rem] border-8 border-[#11161b] bg-[#11161b] shadow-xl">
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
                <p className="pt-10 text-center text-xs text-[#667781]">
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
                        <div className="mb-0.5 inline-flex items-center gap-1 text-[10px] text-[#667781]">
                          <Mic className="size-3" aria-hidden="true" /> nota de voz (transcrita)
                        </div>
                      )}
                      {m.type === 'template' && (
                        <div className="mb-0.5 inline-flex items-center gap-1 text-[10px] text-[#667781]">
                          <ClipboardList className="size-3" aria-hidden="true" /> plantilla (fuera de
                          ventana 24h)
                        </div>
                      )}
                      <p className="whitespace-pre-wrap text-[#111b21]">{m.bodyText ?? m.transcriptText ?? ''}</p>
                      {m.direction === 'outbound' &&
                        m.bodyText &&
                        (() => {
                          const v = videoFromText(m.bodyText);
                          return v?.embedUrl ? (
                            <div className="mt-1.5 aspect-video w-52 overflow-hidden rounded-lg border border-black/10">
                              <iframe
                                src={v.embedUrl}
                                title="video de la lección"
                                className="h-full w-full"
                                allow="encrypted-media; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          ) : null;
                        })()}
                      {m.audioReplyUrl &&
                        (IS_DEMO && !m.audioReplyUrl.startsWith('./demo-audio/') ? (
                          <div className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[10px] text-[#667781]">
                            <Volume2 className="size-3" aria-hidden="true" /> respuesta de voz —
                            silenciada en este demo (el sistema real envía audio TTS)
                          </div>
                        ) : (
                          <div className="mt-1">
                            <div className="mb-0.5 inline-flex items-center gap-1 text-[10px] text-[#667781]">
                              <Volume2 className="size-3" aria-hidden="true" /> respuesta de voz (TTS)
                            </div>
                            <audio controls src={m.audioReplyUrl} className="h-8 w-48" />
                          </div>
                        ))}
                      <div className="mt-0.5 flex items-center justify-end gap-0.5 text-right font-mono text-[9px] tabular-nums text-[#667781]">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {m.direction === 'outbound' && (
                          <CheckCheck className="size-3" aria-hidden="true" />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 bg-[#f0f2f5] px-3 py-2.5">
              <div className="flex flex-wrap gap-1">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setText(q)}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => setMode('text')}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ${mode === 'text' ? 'bg-emerald-700 text-white' : 'bg-white text-[#54656f]'}`}
                >
                  <MessagesSquare className="size-3.5" aria-hidden="true" /> Texto
                </button>
                <button
                  onClick={() => setMode('voice')}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ${mode === 'voice' ? 'bg-emerald-700 text-white' : 'bg-white text-[#54656f]'}`}
                >
                  <Mic className="size-3.5" aria-hidden="true" /> Nota de voz
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
                  className="flex-1 resize-none rounded-full border border-[#d1d7db] bg-white px-4 py-2 text-sm text-[#111b21] focus:outline-none"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !text.trim()}
                  aria-label={t.simulator.sendMessage}
                  className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full bg-emerald-700 text-white disabled:opacity-50"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="text-[10px] text-[#667781]">{t.simulator.tryHint}</p>
            </div>
          </div>
          {nonSpanishHint && (
            <p className="badge-warning mt-2 rounded-md px-3 py-2 text-xs">
              {t.simulator.nonSpanishHint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
