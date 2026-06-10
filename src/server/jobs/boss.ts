import PgBoss from 'pg-boss';
import { config } from '../config.js';
import { QUEUES, handlers, type JobPayloads, type QueueName } from './handlers.js';

let boss: PgBoss | undefined;
let started = false;

/**
 * pg-boss (Postgres-backed queue — no Redis). Queues:
 *   sop-ingest          document extraction/chunking/embedding
 *   inbound-message     webhook processing (webhook responds 200 instantly)
 *   drip-tick           cron: scheduled module delivery + reminders
 *   audit-export        audit pack generation
 *   prune-webhook-logs  cron: drop webhook logs older than 30 days
 */
export async function startJobs(): Promise<void> {
  if (started) return;
  boss = new PgBoss({ connectionString: config().databaseUrl, schema: 'pgboss' });
  boss.on('error', (err) => console.error('[pg-boss]', err.message));
  await boss.start();

  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue).catch(() => {
      /* already exists */
    });
  }

  for (const queue of Object.values(QUEUES) as QueueName[]) {
    await boss.work(queue, { batchSize: 1 }, async (jobs: PgBoss.Job[]) => {
      for (const job of jobs) {
        try {
          await handlers[queue](job.data as never);
        } catch (err) {
          console.error(`[job ${queue}] failed:`, (err as Error).message);
          throw err;
        }
      }
    });
  }

  await boss.schedule(QUEUES.drip, config().dripCron, {}, { tz: 'UTC' });
  await boss.schedule(QUEUES.prune, '0 3 * * *', {}, { tz: 'UTC' });
  started = true;
  console.log(`✓ pg-boss started (drip cron: ${config().dripCron})`);
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop({ close: true, timeout: 5000 });
    boss = undefined;
    started = false;
  }
}

/**
 * Enqueue a job — or run it inline when JOBS_INLINE=true (tests) or the
 * queue isn't running (CLI scripts), so behavior is identical either way.
 */
export async function dispatch<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
): Promise<void> {
  if (config().jobsInline || !started || !boss) {
    await handlers[queue](data);
    return;
  }
  await boss.send(queue, data as object, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 15 * 60,
  });
}
