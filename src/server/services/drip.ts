import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  enrollments,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  workers,
  type Module,
  type ModuleDelivery,
  type Worker,
} from '../db/schema.js';
import { computeScheduledFor } from '../lib/time.js';
import { generateCertificate } from './certificates.js';
import { ES } from './messages.es.js';
import { roleApplies } from './roles.js';
import { sendToWorker } from './sendToWorker.js';
import { synthesizeSpeech } from './speech.js';
import { classifyTopicByKeywords } from './topics.js';
import { logTrainingEvent } from './trainingEvents.js';
import { WINDOW_MS, windowState } from './window.js';

function firstName(fullName: string): string {
  return fullName.split(/\s+/)[0] ?? fullName;
}

/** Strip the citation + video-credit lines + emoji for text-to-speech (they
 *  read awkwardly aloud). The video line keeps a spoken mention but drops the
 *  URL (unspeakable); the source credit is dropped the same way as 📄 Fuente:. */
export function ttsVariant(text: string): string {
  return text
    .split('\n')
    .filter((l) => !l.includes('📄 Fuente:') && !l.includes('Crédito del video:'))
    .map((l) => (l.includes('📹') ? 'Te mandé también un video sobre esto. Míralo en el mensaje.' : l))
    .join('\n')
    .replace(/[📚📄📹✅🎉👋🙏💪😅😊🐄📷ℹ️]/gu, '')
    .trim();
}

/**
 * Reply-audio policy for question answers and check feedback: attach a TTS
 * voice note when the worker sent a voice note (mirror their modality) OR
 * when the per-worker always-audio toggle is set (workers who type but need
 * to listen). Module deliveries are NOT gated by this — they always carry
 * audio.
 */
export function shouldSendAudio(wasVoice: boolean, alwaysAudio: boolean): boolean {
  return wasVoice || alwaysAudio;
}

/**
 * Enroll a worker in a track: creates the enrollment plus one
 * module_delivery per module, scheduled at day_offset/send_hour_local in the
 * org's timezone. Idempotent per (worker, track) while an enrollment is active.
 */
export async function enrollWorker(
  db: Db,
  args: { workerId: string; trackId: string; startedAt?: Date },
): Promise<{ enrollmentId: string; created: boolean }> {
  const existing = await db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.workerId, args.workerId),
        eq(enrollments.trackId, args.trackId),
        eq(enrollments.status, 'active'),
      ),
    );
  if (existing.length > 0) return { enrollmentId: existing[0].id, created: false };

  const [worker] = await db.select().from(workers).where(eq(workers.id, args.workerId));
  if (!worker) throw new Error('Worker not found');
  const [track] = await db
    .select()
    .from(onboardingTracks)
    .where(and(eq(onboardingTracks.id, args.trackId), eq(onboardingTracks.orgId, worker.orgId)));
  if (!track) throw new Error('Track not found');
  const [org] = await db.select().from(orgs).where(eq(orgs.id, worker.orgId));

  const trackModules = await db.select().from(modules).where(eq(modules.trackId, track.id));
  if (trackModules.length === 0) throw new Error('Track has no modules');
  // Role scoping: deliver universal modules + only the role-specific modules
  // that apply to this worker's role.
  const applicable = trackModules.filter((m) => roleApplies(m.appliesToRoles, worker.jobRole));
  if (applicable.length === 0) {
    throw new Error("No modules in this track apply to this worker's role");
  }
  const startedAt = args.startedAt ?? new Date();

  const [enr] = await db
    .insert(enrollments)
    .values({ workerId: worker.id, trackId: track.id, orgId: worker.orgId, startedAt })
    .returning();

  await db.insert(moduleDeliveries).values(
    applicable.map((m) => ({
      enrollmentId: enr.id,
      moduleId: m.id,
      orgId: worker.orgId,
      scheduledFor: computeScheduledFor(startedAt, m.dayOffset, m.sendHourLocal, org.timezone),
      status: 'pending' as const,
    })),
  );
  return { enrollmentId: enr.id, created: true };
}

export function composeModuleMessage(module: Module, orderIndex: number, total: number): string {
  const lines = [
    ES.moduleHeader(orderIndex + 1, total, module.title),
    '',
    module.bodyEs,
  ];
  // Optional video: append a link line (it unfurls in WhatsApp). We never
  // upload/host video — just send the link the manager attached. When the
  // video carries a required source credit, the credit line follows it.
  if (module.videoUrl) {
    lines.push('', ES.videoLine(module.videoTitleEs || module.title, module.videoUrl));
    if (module.videoAttribution) {
      lines.push(ES.videoCredit(module.videoAttribution));
    }
  }
  lines.push('', ES.checkPrompt(module.checkQuestionEs, module.checkOptionsEs));
  return lines.join('\n');
}

/**
 * Deliver the full module (lesson + comprehension check) free-form, with a
 * TTS voice note of the whole lesson — voice-first workers listen, not read.
 */
export async function deliverModule(db: Db, deliveryId: string): Promise<boolean> {
  const [row] = await db
    .select({
      delivery: moduleDeliveries,
      module: modules,
      enrollment: enrollments,
      worker: workers,
    })
    .from(moduleDeliveries)
    .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
    .innerJoin(enrollments, eq(moduleDeliveries.enrollmentId, enrollments.id))
    .innerJoin(workers, eq(enrollments.workerId, workers.id))
    .where(eq(moduleDeliveries.id, deliveryId));
  if (!row) throw new Error('Delivery not found');
  const { delivery, module, enrollment, worker } = row;
  if (delivery.status === 'sent' || delivery.status === 'answered') return false;

  const trackModules = await db.select().from(modules).where(eq(modules.trackId, module.trackId));
  const text = composeModuleMessage(module, module.orderIndex, trackModules.length);
  const audio = await synthesizeSpeech(ttsVariant(text));

  const sent = await sendToWorker(db, worker.id, { text, audioUrl: audio.publicUrl });
  if (!sent.ok) return false;

  await db
    .update(moduleDeliveries)
    .set({
      status: 'sent',
      sentAt: new Date(),
      channelMessageSid: sent.sids[0] ?? null,
      updatedAt: new Date(),
    })
    .where(eq(moduleDeliveries.id, delivery.id));

  await logTrainingEvent(db, {
    orgId: enrollment.orgId,
    workerId: worker.id,
    eventType: 'module_delivered',
    topic: classifyTopicByKeywords(`${module.title} ${module.bodyEs}`),
    farmTopic: module.farmTopic,
    answerText: `Módulo entregado: ${module.title}`,
    sourceDocumentId: module.sourceDocumentId,
    confidence: 'grounded',
  });
  return true;
}

/** Deliver any modules stuck in `notified` once the worker's window reopens. */
export async function deliverNotifiedModules(db: Db, workerId: string): Promise<number> {
  const rows = await db
    .select({ delivery: moduleDeliveries })
    .from(moduleDeliveries)
    .innerJoin(enrollments, eq(moduleDeliveries.enrollmentId, enrollments.id))
    .where(
      and(
        eq(enrollments.workerId, workerId),
        eq(enrollments.status, 'active'),
        eq(moduleDeliveries.status, 'notified'),
      ),
    )
    .orderBy(moduleDeliveries.scheduledFor);
  let delivered = 0;
  for (const { delivery } of rows) {
    if (await deliverModule(db, delivery.id)) delivered++;
  }
  return delivered;
}

export interface CheckContext {
  delivery: ModuleDelivery;
  module: Module;
  worker: Worker;
}

/** The worker's most recent unanswered, already-sent check (if any). */
export async function findPendingCheck(db: Db, workerId: string): Promise<CheckContext | null> {
  const rows = await db
    .select({ delivery: moduleDeliveries, module: modules, worker: workers })
    .from(moduleDeliveries)
    .innerJoin(enrollments, eq(moduleDeliveries.enrollmentId, enrollments.id))
    .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
    .innerJoin(workers, eq(enrollments.workerId, workers.id))
    .where(
      and(
        eq(enrollments.workerId, workerId),
        eq(enrollments.status, 'active'),
        eq(moduleDeliveries.status, 'sent'),
        isNull(moduleDeliveries.checkAnsweredAt),
      ),
    )
    .orderBy(moduleDeliveries.sentAt);
  const last = rows[rows.length - 1];
  return last ?? null;
}

/**
 * Grade a comprehension-check answer. Correct → praise; incorrect → give the
 * correct answer with the explanation, no re-quiz (confirmation touchpoint,
 * not an exam). Completing the final module completes the enrollment and
 * generates the certificate.
 */
export async function handleCheckAnswer(
  db: Db,
  ctx: CheckContext,
  answerIndex: number,
  opts: { wasVoice: boolean },
): Promise<void> {
  const { delivery, module, worker } = ctx;
  const passed = answerIndex === module.checkCorrectIndex;
  const now = new Date();

  await db
    .update(moduleDeliveries)
    .set({
      status: 'answered',
      checkAnsweredAt: now,
      checkAnswerIndex: answerIndex,
      checkPassed: passed,
      updatedAt: now,
    })
    .where(eq(moduleDeliveries.id, delivery.id));

  const reply = passed
    ? ES.checkCorrect
    : ES.checkIncorrect(
        module.checkCorrectIndex + 1,
        module.checkOptionsEs[module.checkCorrectIndex],
      );
  const audio = shouldSendAudio(opts.wasVoice, worker.alwaysAudio)
    ? await synthesizeSpeech(ttsVariant(reply))
    : null;
  await sendToWorker(db, worker.id, { text: reply, audioUrl: audio?.publicUrl, kind: 'reply' });

  await logTrainingEvent(db, {
    orgId: worker.orgId,
    workerId: worker.id,
    eventType: passed ? 'check_passed' : 'check_failed',
    topic: classifyTopicByKeywords(`${module.title} ${module.bodyEs}`),
    farmTopic: module.farmTopic,
    questionText: module.checkQuestionEs,
    answerText: `Respuesta: ${answerIndex + 1}) ${module.checkOptionsEs[answerIndex] ?? ''}`,
    sourceDocumentId: module.sourceDocumentId,
    confidence: 'grounded',
  });

  // Completion check: all deliveries for this enrollment answered?
  const remaining = await db
    .select({ id: moduleDeliveries.id })
    .from(moduleDeliveries)
    .where(
      and(
        eq(moduleDeliveries.enrollmentId, delivery.enrollmentId),
        isNull(moduleDeliveries.checkAnsweredAt),
      ),
    );
  if (remaining.length === 0) {
    await db
      .update(enrollments)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(enrollments.id, delivery.enrollmentId));
    await generateCertificate(db, delivery.enrollmentId);
    const [enr] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, delivery.enrollmentId));
    const [trk] = await db
      .select()
      .from(onboardingTracks)
      .where(eq(onboardingTracks.id, enr.trackId));
    await sendToWorker(db, worker.id, {
      text: ES.trackComplete(firstName(worker.name), trk?.name ?? 'de capacitación'),
      kind: 'reply',
    });
  }
}

export interface DripTickResult {
  delivered: number;
  notified: number;
  reminded: number;
}

/**
 * The scheduler tick (pg-boss cron + manual trigger):
 *  1. due pending deliveries → deliver free-form if the worker's 24h window
 *     is open, otherwise send the pre-approved notify template and mark
 *     `notified` (full module goes out when the worker replies).
 *  2. unanswered checks >24h old → one gentle reminder (max 1 retry).
 *
 * Only opted-in workers receive anything (Meta opt-in policy) — workers in
 * 'pending'/'opted_out' are skipped entirely and surfaced in the dashboard
 * as "awaiting opt-in" / "opted out". sendToWorker enforces the same gate.
 */
export async function runDripTick(db: Db, now: Date = new Date()): Promise<DripTickResult> {
  const result: DripTickResult = { delivered: 0, notified: 0, reminded: 0 };

  const due = await db
    .select({ delivery: moduleDeliveries, module: modules, worker: workers })
    .from(moduleDeliveries)
    .innerJoin(enrollments, eq(moduleDeliveries.enrollmentId, enrollments.id))
    .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
    .innerJoin(workers, eq(enrollments.workerId, workers.id))
    .where(
      and(
        eq(moduleDeliveries.status, 'pending'),
        lte(moduleDeliveries.scheduledFor, now),
        eq(enrollments.status, 'active'),
        eq(workers.status, 'active'),
        eq(workers.consentStatus, 'opted_in'),
      ),
    )
    .orderBy(moduleDeliveries.scheduledFor);

  for (const { delivery, module, worker } of due) {
    if (windowState(worker.lastInboundAt, now) === 'open') {
      if (await deliverModule(db, delivery.id)) result.delivered++;
    } else {
      const sent = await sendToWorker(db, worker.id, {
        text: '',
        template: {
          name: 'establo_module_notify',
          vars: [firstName(worker.name), module.title],
        },
      });
      if (sent.ok) {
        await db
          .update(moduleDeliveries)
          .set({ status: 'notified', updatedAt: now })
          .where(eq(moduleDeliveries.id, delivery.id));
        result.notified++;
      }
    }
  }

  // Gentle reminder for unanswered checks, once.
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const stale = await db
    .select({ delivery: moduleDeliveries, module: modules, worker: workers })
    .from(moduleDeliveries)
    .innerJoin(enrollments, eq(moduleDeliveries.enrollmentId, enrollments.id))
    .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
    .innerJoin(workers, eq(enrollments.workerId, workers.id))
    .where(
      and(
        eq(moduleDeliveries.status, 'sent'),
        isNull(moduleDeliveries.checkAnsweredAt),
        lte(moduleDeliveries.sentAt, cutoff),
        eq(moduleDeliveries.retryCount, 0),
        eq(enrollments.status, 'active'),
        eq(workers.status, 'active'),
        eq(workers.consentStatus, 'opted_in'),
      ),
    );

  for (const { delivery, module, worker } of stale) {
    const open = windowState(worker.lastInboundAt, now) === 'open';
    const sent = open
      ? await sendToWorker(db, worker.id, { text: ES.checkReminderFreeform(module.title) })
      : await sendToWorker(db, worker.id, {
          text: '',
          template: {
            name: 'establo_check_reminder',
            vars: [firstName(worker.name), module.title],
          },
        });
    if (sent.ok) {
      await db
        .update(moduleDeliveries)
        .set({ retryCount: 1, updatedAt: now })
        .where(eq(moduleDeliveries.id, delivery.id));
      result.reminded++;
    }
  }

  return result;
}
