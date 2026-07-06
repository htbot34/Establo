import { eq, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { webhookLogs } from '../db/schema.js';
import { runAuditExport } from '../services/auditPack.js';
import { runDripTick } from '../services/drip.js';
import { ingestDocument } from '../services/ingestion.js';
import { processInbound, type InboundPayload } from '../services/inbound.js';
import { pruneRawContent } from '../services/retention.js';

export const QUEUES = {
  ingest: 'sop-ingest',
  inbound: 'inbound-message',
  drip: 'drip-tick',
  audit: 'audit-export',
  prune: 'prune-webhook-logs',
  retentionPrune: 'prune-raw-content',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  'sop-ingest': { documentId: string };
  'inbound-message': { payload: InboundPayload; webhookLogId?: string };
  'drip-tick': Record<string, never>;
  'audit-export': { exportId: string };
  'prune-webhook-logs': Record<string, never>;
  'prune-raw-content': Record<string, never>;
}

type Handler<Q extends QueueName> = (data: JobPayloads[Q]) => Promise<void>;

export const handlers: { [Q in QueueName]: Handler<Q> } = {
  'sop-ingest': async ({ documentId }) => {
    await ingestDocument(getDb(), documentId);
  },

  'inbound-message': async ({ payload, webhookLogId }) => {
    const db = getDb();
    try {
      await processInbound(db, payload);
      if (webhookLogId) {
        await db
          .update(webhookLogs)
          .set({ processed: true, updatedAt: new Date() })
          .where(eq(webhookLogs.id, webhookLogId));
      }
    } catch (err) {
      if (webhookLogId) {
        await db
          .update(webhookLogs)
          .set({ errorText: (err as Error).message, updatedAt: new Date() })
          .where(eq(webhookLogs.id, webhookLogId));
      }
      throw err;
    }
  },

  'drip-tick': async () => {
    const result = await runDripTick(getDb());
    if (result.delivered + result.notified + result.reminded > 0) {
      console.log(
        `⏰ drip tick: ${result.delivered} delivered, ${result.notified} notified (window closed), ${result.reminded} reminded`,
      );
    }
  },

  'audit-export': async ({ exportId }) => {
    await runAuditExport(getDb(), exportId);
  },

  'prune-webhook-logs': async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
    await getDb().delete(webhookLogs).where(lt(webhookLogs.createdAt, cutoff));
  },

  'prune-raw-content': async () => {
    const result = await pruneRawContent(getDb());
    if (result.messagesRedacted + result.eventsRedacted + result.filesDeleted > 0) {
      // Counts only — the whole point of this job is that content expires.
      console.log(
        `🧹 retention: ${result.messagesRedacted} messages redacted, ` +
          `${result.eventsRedacted} training events redacted, ${result.filesDeleted} files deleted`,
      );
    }
  },
};
