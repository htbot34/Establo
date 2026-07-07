import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../api';
import { Card, PageHeader, Spinner, Sparkline, StatusBadge } from '../components';
import { useFmt, useT } from '../i18n';

interface OverviewData {
  activeWorkers: number;
  questionsThisWeek: number;
  modulesDeliveredThisWeek: number;
  openKnowledgeGaps: number;
  dataDeletions: Array<{ id: string; deletedAt: string }>;
  sparkline: Array<{ date: string; count: number }>;
  recentEscalations: Array<{
    id: string;
    workerName: string;
    questionText: string;
    reason: string;
    status: string;
    createdAt: string;
  }>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const danger = accent && value > 0;
  return (
    <Card className="p-5">
      <div
        className={`font-mono text-3xl font-medium tabular-nums ${
          danger ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </Card>
  );
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const t = useT();
  const { fmtDate, timeAgo } = useFmt();
  useEffect(() => {
    void api<OverviewData>('/api/overview').then(setData);
  }, []);
  if (!data) return <Spinner />;

  const totalEvents = data.sparkline.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      <PageHeader title={t.overview.title} subtitle={t.overview.subtitle} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t.overview.activeWorkers} value={data.activeWorkers} />
        <Stat label={t.overview.questionsThisWeek} value={data.questionsThisWeek} />
        <Stat label={t.overview.modulesDelivered7d} value={data.modulesDeliveredThisWeek} />
        <Stat label={t.overview.openKnowledgeGaps} value={data.openKnowledgeGaps} accent />
      </div>

      {(data.dataDeletions ?? []).length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="text-sm font-medium text-foreground">{t.overview.deletionNoticesTitle}</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {data.dataDeletions.map((d) => (
              <li key={d.id}>
                {t.overview.deletionBeforeDate}{' '}
                <span className="font-mono tabular-nums">{fmtDate(d.deletedAt)}</span>
                {t.overview.deletionAfterDate}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-foreground">{t.overview.activityTitle}</h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {t.overview.eventsCount(totalEvents)}
          </span>
        </div>
        <Sparkline data={data.sparkline} />
        <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>{data.sparkline[0]?.date}</span>
          <span>{data.sparkline[data.sparkline.length - 1]?.date}</span>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-foreground">{t.overview.recentEscalations}</h2>
          <Link
            to="/conversations"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t.overview.viewAll}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        {data.recentEscalations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t.overview.noOpenEscalations}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.recentEscalations.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">"{e.questionText}"</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.workerName} · {e.reason} · {timeAgo(e.createdAt)}
                  </p>
                </div>
                <StatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
