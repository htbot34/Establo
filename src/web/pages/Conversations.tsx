import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Mic, Volume2 } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api, IS_DEMO } from '../api';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../components';
import { useFmt, useT } from '../i18n';
import { DataTable } from '../ui/data-table';
import { videoFromText } from '../../server/services/video';

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
  const t = useT();
  const { fmtDateTime, timeAgo } = useFmt();

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

  const resolve = useCallback(
    async (id: string) => {
      await api(`/api/escalations/${id}/resolve`, { method: 'POST' });
      await loadEscalations();
    },
    [loadEscalations],
  );

  const escalationColumns = useMemo<ColumnDef<Escalation>[]>(
    () => [
      {
        accessorKey: 'workerName',
        header: t.conversations.colWorker,
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.workerName}</span>
        ),
      },
      {
        accessorKey: 'questionText',
        header: t.conversations.colQuestion,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-foreground" title={row.original.questionText}>
            "{row.original.questionText}"
          </span>
        ),
      },
      {
        accessorKey: 'reason',
        header: t.conversations.colReason,
        cell: ({ row }) => <Badge color="stone">{row.original.reason}</Badge>,
      },
      {
        accessorKey: 'createdAt',
        header: t.conversations.colRaised,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{timeAgo(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t.conversations.colStatus,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) =>
          row.original.status === 'open' ? (
            <Button variant="secondary" onClick={() => void resolve(row.original.id)}>
              {t.conversations.markResolved}
            </Button>
          ) : null,
      },
    ],
    [resolve, t, timeAgo],
  );

  const tabs = [
    { key: 'conversations' as const, label: t.conversations.tabConversations },
    { key: 'escalations' as const, label: t.conversations.tabEscalations },
  ];

  return (
    <div>
      <PageHeader title={t.conversations.title} subtitle={t.conversations.subtitle} />
      <div className="mb-4 flex w-fit gap-1 rounded-md bg-muted p-1 text-sm font-medium">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-sm px-4 py-1.5 transition-colors ${
              tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'conversations' ? (
        <div className="grid grid-cols-5 gap-4">
          <Card className="col-span-2 max-h-[70vh] overflow-y-auto">
            {!convs ? (
              <Spinner />
            ) : convs.length === 0 ? (
              <EmptyState title={t.conversations.noConversations} />
            ) : (
              <ul className="divide-y divide-border">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => void open(c)}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-accent ${
                        selected?.id === c.id ? 'bg-navactive-bg' : ''
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{c.workerName}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="font-mono text-xs tabular-nums text-muted-foreground">
                        {t.conversations.messagesCount(c.messageCount)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="col-span-3 max-h-[70vh] overflow-y-auto bg-muted/30">
            {!selected ? (
              <EmptyState title={t.conversations.pickConversation} />
            ) : !msgs ? (
              <Spinner />
            ) : (
              <div className="space-y-2 p-4">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3.5 py-2 text-sm shadow-sm ${
                        m.direction === 'inbound'
                          ? 'rounded-bl-sm border border-border bg-card text-foreground'
                          : 'rounded-br-sm bg-primary text-primary-foreground'
                      }`}
                    >
                      {m.type === 'voice' && m.direction === 'inbound' && (
                        <div className="mb-1 inline-flex items-center gap-1 text-xs opacity-70">
                          <Mic className="size-3" aria-hidden="true" /> {t.conversations.voiceNote}
                        </div>
                      )}
                      {m.type === 'template' && (
                        <div className="mb-1 inline-flex items-center gap-1 text-xs opacity-70">
                          <ClipboardList className="size-3" aria-hidden="true" />{' '}
                          {t.conversations.template}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{m.bodyText ?? m.transcriptText ?? ''}</p>
                      {m.direction === 'outbound' &&
                        m.bodyText &&
                        (() => {
                          const v = videoFromText(m.bodyText);
                          return v?.embedUrl ? (
                            <div className="mt-1.5 aspect-video w-56 overflow-hidden rounded-md border border-white/30">
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
                        (IS_DEMO ? (
                          <div className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-black/10 px-3 py-1 text-xs opacity-90">
                            <Volume2 className="size-3" aria-hidden="true" />{' '}
                            {t.conversations.demoVoicePill}
                          </div>
                        ) : (
                          <audio controls src={m.audioReplyUrl} className="mt-1.5 h-9 w-52" />
                        ))}
                      <div
                        className={`mt-1 font-mono text-[10px] tabular-nums ${
                          m.direction === 'inbound' ? 'text-muted-foreground' : 'text-primary-foreground/80'
                        }`}
                      >
                        {fmtDateTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : !escalations ? (
        <Card>
          <Spinner />
        </Card>
      ) : escalations.length === 0 ? (
        <Card>
          <EmptyState
            title={t.conversations.noEscalationsTitle}
            hint={t.conversations.noEscalationsHint}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={escalationColumns}
            data={escalations}
            initialSorting={[{ id: 'createdAt', desc: true }]}
          />
        </Card>
      )}
    </div>
  );
}
