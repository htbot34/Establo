import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  conversations,
  deletionLog,
  escalations,
  messages,
  trainingEvents,
  workers,
} from '../db/schema.js';
import { deleteAudioReplyFile } from './retention.js';

/**
 * Irreversible worker-data redaction (BORRAR MIS DATOS, or the manager's
 * "Delete worker data" action — both run through here):
 *
 *  - workers.name → "Trabajador eliminado"; phone → `deleted:<uuid>` (a
 *    tombstone that satisfies the org-scoped unique constraint and can never
 *    resolve an inbound message again); notes cleared; status inactive;
 *    consent opted_out so every send gate fails closed.
 *  - every message row: bodyText/transcriptText/mediaUrl/audioReplyUrl
 *    nulled, local audio files deleted from disk first.
 *  - training_events: questionText/answerText nulled — the derived
 *    documentation fields (topic, farm_topic, confidence, check results,
 *    timestamps) survive, same as the retention prune.
 *  - escalations: verbatim question text replaced with a neutral marker.
 *  - one deletion_log row (timestamp + org ONLY) so the dashboard can show a
 *    non-identifying notice.
 *
 * Idempotent: a second call on an already-deleted worker is a no-op.
 */
export async function deleteWorkerData(db: Db, workerId: string): Promise<boolean> {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId));
  if (!worker || worker.deletedAt) return false;
  const now = new Date();

  const convs = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.workerId, workerId));
  const convIds = convs.map((c) => c.id);
  if (convIds.length > 0) {
    const audioRows = await db
      .select({ audioReplyUrl: messages.audioReplyUrl })
      .from(messages)
      .where(and(inArray(messages.conversationId, convIds), isNotNull(messages.audioReplyUrl)));
    for (const row of audioRows) {
      await deleteAudioReplyFile(row.audioReplyUrl!);
    }
    await db
      .update(messages)
      .set({
        bodyText: null,
        transcriptText: null,
        mediaUrl: null,
        audioReplyUrl: null,
        updatedAt: now,
      })
      .where(inArray(messages.conversationId, convIds));
  }

  await db
    .update(trainingEvents)
    .set({ questionText: null, answerText: null, updatedAt: now })
    .where(eq(trainingEvents.workerId, workerId));

  await db
    .update(escalations)
    .set({ questionText: 'Eliminado a petición del trabajador', updatedAt: now })
    .where(eq(escalations.workerId, workerId));

  await db
    .update(workers)
    .set({
      name: 'Trabajador eliminado',
      phoneE164: `deleted:${randomUUID()}`,
      notes: null,
      status: 'inactive',
      consentStatus: 'opted_out',
      deletedAt: now,
      deletionRequestedAt: null,
      pendingAgreementId: null,
      pendingAgreementSentAt: null,
      pendingAgreementNudges: 0,
      updatedAt: now,
    })
    .where(eq(workers.id, workerId));

  await db.insert(deletionLog).values({ orgId: worker.orgId });
  return true;
}
