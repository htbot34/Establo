import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agreements,
  agreementSignatures,
  orgs,
  workers,
  type Agreement,
  type AgreementSignature,
  type Worker,
} from '../db/schema.js';
import { ES } from './messages.es.js';
import { sendToWorker } from './sendToWorker.js';

/**
 * Cow care agreements (FARM Animal Care v5 requires a signed agreement for
 * every employee with animal care responsibilities, renewed annually). The
 * agreement text is versioned per org; a worker signs by replying ACEPTO on
 * WhatsApp (the reply + timestamp + version IS the signature record) or on
 * paper with a manager attestation.
 */

export { RENEWAL_DUE_MONTHS, renewalDue } from './consentKeywords.js';
import { renewalDue } from './consentKeywords.js';

export const DEFAULT_COW_CARE_AGREEMENT_ES = `ACUERDO DE CUIDADO DE LAS VACAS

Yo, como trabajador de esta lechería, me comprometo a:

1) Tratar a todos los animales con calma y respeto, siempre. Nunca golpear, patear, gritar ni usar la chicharra eléctrica.
2) Mover a las vacas a su paso, sin prisa, usando mi posición y el punto de balance.
3) Avisar de inmediato al encargado si veo una vaca caída, enferma, coja o lastimada. Nunca arrastrar a un animal caído.
4) Cuidar con especial atención a las becerras recién nacidas siguiendo los procedimientos de la lechería.
5) Seguir los procedimientos escritos de la lechería en todo momento, y preguntar cuando tenga dudas.
6) Reportar al encargado o al dueño cualquier maltrato de animales que vea, sin miedo: reportar es parte de mi trabajo y no tendré represalias.

Entiendo que el buen trato de los animales es condición de mi trabajo en esta lechería.

Para firmar este acuerdo, responde con la palabra ACEPTO.`;

/** The org's active agreement, creating the default v1 if none exists yet. */
export async function getOrCreateActiveAgreement(db: Db, orgId: string): Promise<Agreement> {
  const [existing] = await db
    .select()
    .from(agreements)
    .where(and(eq(agreements.orgId, orgId), eq(agreements.type, 'cow_care'), eq(agreements.active, true)))
    .orderBy(desc(agreements.version))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(agreements)
    .values({ orgId, type: 'cow_care', version: 1, textEs: DEFAULT_COW_CARE_AGREEMENT_ES })
    .returning();
  return created;
}

/** Editing the text creates a new version (old signatures keep pointing at theirs). */
export async function updateAgreementText(db: Db, orgId: string, textEs: string): Promise<Agreement> {
  const current = await getOrCreateActiveAgreement(db, orgId);
  if (current.textEs === textEs) return current;
  await db
    .update(agreements)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(agreements.id, current.id));
  const [next] = await db
    .insert(agreements)
    .values({ orgId, type: 'cow_care', version: current.version + 1, textEs })
    .returning();
  return next;
}

export async function latestSignature(
  db: Db,
  workerId: string,
): Promise<AgreementSignature | null> {
  const [sig] = await db
    .select()
    .from(agreementSignatures)
    .where(eq(agreementSignatures.workerId, workerId))
    .orderBy(desc(agreementSignatures.signedAt))
    .limit(1);
  return sig ?? null;
}

export interface AgreementStatus {
  signed: boolean;
  signedAt: Date | null;
  version: number | null;
  method: 'whatsapp' | 'paper' | null;
  renewalDue: boolean;
  pendingSince: Date | null;
}

export async function agreementStatusFor(db: Db, worker: Worker): Promise<AgreementStatus> {
  const sig = await latestSignature(db, worker.id);
  return {
    signed: !!sig,
    signedAt: sig?.signedAt ?? null,
    version: sig?.agreementVersion ?? null,
    method: (sig?.method as 'whatsapp' | 'paper' | undefined) ?? null,
    renewalDue: sig ? renewalDue(sig.signedAt) : false,
    pendingSince: worker.pendingAgreementSentAt,
  };
}

function composeAgreementMessage(dairyName: string, agreement: Agreement): string {
  return [ES.agreementIntro(dairyName), '', agreement.textEs].join('\n');
}

export type SendAgreementOutcome = 'sent' | 'queued' | 'blocked';

/**
 * Manager triggers "send agreement": deliver now if the worker's 24h window
 * is open; otherwise mark it pending so it goes out with their next inbound
 * message (there is no approved template for agreement text). Either way the
 * pending state is what ACEPTO is matched against.
 */
export async function requestAgreementSignature(
  db: Db,
  workerId: string,
): Promise<SendAgreementOutcome> {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId));
  if (!worker) throw new Error('Worker not found');
  if (worker.consentStatus !== 'opted_in') return 'blocked';
  const agreement = await getOrCreateActiveAgreement(db, worker.orgId);
  const now = new Date();
  await db
    .update(workers)
    .set({
      pendingAgreementId: agreement.id,
      pendingAgreementSentAt: null,
      pendingAgreementNudges: 0,
      updatedAt: now,
    })
    .where(eq(workers.id, worker.id));

  const [org] = await db.select().from(orgs).where(eq(orgs.id, worker.orgId));
  const sent = await sendToWorker(db, worker.id, {
    text: composeAgreementMessage(org.name, agreement),
    kind: 'business',
  });
  if (!sent.ok) return sent.reason === 'window_closed' ? 'queued' : 'blocked';
  await db
    .update(workers)
    .set({ pendingAgreementSentAt: now, updatedAt: now })
    .where(eq(workers.id, worker.id));
  return 'sent';
}

/** Deliver a queued agreement once the worker's window reopens (inbound path). */
export async function deliverPendingAgreement(db: Db, worker: Worker): Promise<boolean> {
  if (!worker.pendingAgreementId || worker.pendingAgreementSentAt) return false;
  const [agreement] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, worker.pendingAgreementId));
  if (!agreement) return false;
  const [org] = await db.select().from(orgs).where(eq(orgs.id, worker.orgId));
  const sent = await sendToWorker(db, worker.id, {
    text: composeAgreementMessage(org.name, agreement),
    kind: 'reply',
  });
  if (!sent.ok) return false;
  const now = new Date();
  await db
    .update(workers)
    .set({ pendingAgreementSentAt: now, updatedAt: now })
    .where(eq(workers.id, worker.id));
  worker.pendingAgreementSentAt = now;
  return true;
}

export async function recordSignature(
  db: Db,
  args: {
    orgId: string;
    workerId: string;
    agreementId: string;
    agreementVersion: number;
    method: 'whatsapp' | 'paper';
    attestedBy?: string;
    signedAt?: Date;
  },
): Promise<AgreementSignature> {
  const [sig] = await db
    .insert(agreementSignatures)
    .values({
      orgId: args.orgId,
      workerId: args.workerId,
      agreementId: args.agreementId,
      agreementVersion: args.agreementVersion,
      method: args.method,
      attestedBy: args.attestedBy ?? null,
      signedAt: args.signedAt ?? new Date(),
    })
    .returning();
  await db
    .update(workers)
    .set({
      pendingAgreementId: null,
      pendingAgreementSentAt: null,
      pendingAgreementNudges: 0,
      updatedAt: new Date(),
    })
    .where(eq(workers.id, args.workerId));
  return sig;
}
