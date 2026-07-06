import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { workers, type ConsentMethod, type Worker } from '../db/schema.js';

/**
 * Worker opt-in / opt-out (Meta WhatsApp Business policy). An employer adding
 * a worker in the dashboard is NOT valid opt-in — the worker must either
 * message the number themselves (ALTA or any first message) or sign a paper
 * form the manager attests to. BAJA (and obvious variants) opts out and
 * blocks every send until the worker writes ALTA again.
 */

export {
  DELETION_CONFIRM_WINDOW_MS,
  isAceptoReply,
  isDeletionConfirm,
  isDeletionRequest,
  parseConsentKeyword,
  type ConsentKeyword,
} from './consentKeywords.js';

export async function optInWorker(
  db: Db,
  workerId: string,
  method: ConsentMethod,
  attestedBy?: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(workers)
    .set({
      consentStatus: 'opted_in',
      consentedAt: now,
      consentMethod: method,
      consentAttestedBy: attestedBy ?? null,
      updatedAt: now,
    })
    .where(eq(workers.id, workerId));
}

export async function optOutWorker(db: Db, workerId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(workers)
    .set({
      consentStatus: 'opted_out',
      consentedAt: now,
      consentMethod: 'whatsapp_keyword',
      consentAttestedBy: null,
      updatedAt: now,
    })
    .where(eq(workers.id, workerId));
}

export async function markDisclosureSent(
  db: Db,
  workerId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(workers)
    .set({ disclosureSentAt: now, updatedAt: now })
    .where(eq(workers.id, workerId));
}

export function needsDisclosure(worker: Pick<Worker, 'disclosureSentAt'>): boolean {
  return worker.disclosureSentAt == null;
}
