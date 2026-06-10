import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, timeAgo } from '../api';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, statusBadge } from '../components';

interface Conv {
  id: string;
  workerId: string;
  workerName: string;
  workerPhone: string;
  lastMessageAt: string;
  messageCount: number;
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

interface Escalation {
  id: string;
  workerName: string;
  questionText: string;
  reason: string;
  status: string;
  createdAt: string;
}

export default function Conversations() {
  const [tab, setTab] = useState<'conversations' | 'escalations'>('conversations');
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);

  useEffect(() => {
    void api<Conv[]>('/api/conversations').then(setConvs);
  }, []);

  const loadEscalations = useCallback(async () => {
    setEscalations(await api<Escalation[]>('/api/escalations'));
  }, []);
  useEffect(() => {
    if (tab === 'escalations') void loadEscalations();
  }, [tab, loadEscalations]);

  async function open(conv: Conv) {
    setSelected(conv);
    setMsgs(null);
    setMsgs(await api<Msg[]>(`/api/conversations/${conv.id}/messages`));
  }

  async function resolve(id: string) {
    await api(`/api/escalations/${id}/resolve`, { method: 'POST' });
    await loadEscalations();
  }

  return (
    <div>
      <PageHeader
        title="Conversations"
        subtitle="Read-only view of worker chats, plus the escalations inbox"
      />
      <div className="mb-4 flex gap-1 rounded-lg bg-stone-200/60 p-1 text-sm font-medium w-fit">
        {(['conversations', 'escalations'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 capitalize ${tab === t ? 'bg-white shadow-sm' : 'text-stone-500'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'conversations' ? (
        <div className="grid grid-cols-5 gap-4">
          <Card className="col-span-2 max-h-[70vh] overflow-y-auto">
            {!convs ? (
              <Spinner />
            ) : convs.length === 0 ? (
              <EmptyState title="No conversations yet" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => void open(c)}
                      className={`w-full px-4 py-3 text-left hover:bg-stone-50 ${selected?.id === c.id ? 'bg-green-50' : ''}`}
                    >
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-stone-800">{c.workerName}</span>
                        <span className="text-xs text-stone-400">{timeAgo(c.lastMessageAt)}</span>
                      </div>
                      <div className="text-xs text-stone-400">{c.messageCount} messages</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="col-span-3 max-h-[70vh] overflow-y-auto bg-stone-50">
            {!selected ? (
              <EmptyState title="Pick a conversation" />
            ) : !msgs ? (
              <Spinner />
            ) : (
              <div className="space-y-2 p-4">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        m.direction === 'inbound'
                          ? 'rounded-bl-sm bg-white text-stone-800'
                          : 'rounded-br-sm bg-green-700 text-white'
                      }`}
                    >
                      {m.type === 'voice' && m.direction === 'inbound' && (
                        <div className="mb-1 text-xs opacity-70">🎤 voice note (transcript)</div>
                      )}
                      {m.type === 'template' && <div className="mb-1 text-xs opacity-70">📋 template</div>}
                      <p className="whitespace-pre-wrap">{m.bodyText ?? m.transcriptText ?? ''}</p>
                      {m.audioReplyUrl && (
                        <audio controls src={m.audioReplyUrl} className="mt-1.5 h-9 w-52" />
                      )}
                      <div className={`mt-1 text-[10px] ${m.direction === 'inbound' ? 'text-stone-400' : 'text-green-100'}`}>
                        {fmtDateTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          {!escalations ? (
            <Spinner />
          ) : escalations.length === 0 ? (
            <EmptyState title="No escalations" hint="When Establo can't answer from your SOPs, the gap shows up here." />
          ) : (
            <ul className="divide-y divide-stone-100">
              {escalations.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800">“{e.questionText}”</p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {e.workerName} · <Badge color="stone">{e.reason}</Badge> · {timeAgo(e.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {statusBadge(e.status)}
                    {e.status === 'open' && (
                      <Button variant="secondary" onClick={() => void resolve(e.id)}>
                        Mark resolved
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
