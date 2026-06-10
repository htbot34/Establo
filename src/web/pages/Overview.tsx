import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api';
import { Card, PageHeader, Spinner, Sparkline, statusBadge } from '../components';

interface OverviewData {
  activeWorkers: number;
  questionsThisWeek: number;
  modulesDeliveredThisWeek: number;
  openKnowledgeGaps: number;
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
  return (
    <Card className="p-5">
      <div className={`text-3xl font-semibold ${accent && value > 0 ? 'text-red-600' : 'text-stone-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-sm text-stone-500">{label}</div>
    </Card>
  );
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => {
    void api<OverviewData>('/api/overview').then(setData);
  }, []);
  if (!data) return <Spinner />;

  return (
    <div>
      <PageHeader title="Overview" subtitle="What's happening across your dairy's training" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active workers" value={data.activeWorkers} />
        <Stat label="Questions this week" value={data.questionsThisWeek} />
        <Stat label="Modules delivered (7d)" value={data.modulesDeliveredThisWeek} />
        <Stat label="Open knowledge gaps" value={data.openKnowledgeGaps} accent />
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-stone-700">Training activity — last 14 days</h2>
          <span className="text-xs text-stone-400">
            {data.sparkline.reduce((a, b) => a + b.count, 0)} events
          </span>
        </div>
        <Sparkline data={data.sparkline} />
        <div className="mt-1 flex justify-between text-[10px] text-stone-400">
          <span>{data.sparkline[0]?.date}</span>
          <span>{data.sparkline[data.sparkline.length - 1]?.date}</span>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-stone-700">Recent escalations</h2>
          <Link to="/conversations" className="text-xs font-medium text-green-800 hover:underline">
            View all →
          </Link>
        </div>
        {data.recentEscalations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-stone-400">No escalations — all quiet. 🎉</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.recentEscalations.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-stone-800">“{e.questionText}”</p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {e.workerName} · {e.reason} · {timeAgo(e.createdAt)}
                  </p>
                </div>
                {statusBadge(e.status)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
