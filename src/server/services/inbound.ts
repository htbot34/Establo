import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agreements,
  conversations,
  escalations,
  messages,
  orgs,
  workers,
  type Worker,
} from '../db/schema.js';
import { config } from '../config.js';
import { maskPhone, normalizeWhatsAppAddress } from '../lib/phone.js';
import { absPath, saveBuffer } from '../lib/storage.js';
import { deliverPendingAgreement, recordSignature } from './agreements.js';
import { answerQuestion } from './answer.js';
import {
  DELETION_CONFIRM_WINDOW_MS,
  isAceptoReply,
  isDeletionConfirm,
  isDeletionRequest,
  markDisclosureSent,
  needsDisclosure,
  optInWorker,
  optOutWorker,
  parseConsentKeyword,
  type ConsentKeyword,
} from './consent.js';
import { deliverNotifiedModules, findPendingCheck, handleCheckAnswer, ttsVariant } from './drip.js';
import { mapToFarmTopic } from './farmTopics.js';
import { matchForbiddenTopic } from './guards.js';
import { looksSpanish } from './language.js';
import { ES } from './messages.es.js';
import { checkRateLimit } from './rateLimit.js';
import { routeInbound } from './router.js';
import { sendToWorker } from './sendToWorker.js';
import { synthesizeSpeech, transcribeAudio } from './speech.js';
import { logTrainingEvent } from './trainingEvents.js';
import { downloadTwilioMedia, getTransport } from './transport.js';
import { deleteWorkerData } from './workerDeletion.js';

/** Twilio inbound webhook form fields we care about. */
export interface InboundPayload {
  From?: string;
  Body?: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  MessageSid?: string;
  /** Mock-mode only: the simulator supplies the "voice note" transcript directly. */
  MockTranscript?: string;
  [key: string]: string | undefined;
}

// Reply at most once per day per unknown phone (avoid spamming wrong numbers).
const unknownPhoneReplies = new Map<string, number>();
// Same for "you're opted out" reminders — never badger an opted-out worker.
const optedOutReminders = new Map<string, number>();

export function resetInboundCachesForTests(): void {
  unknownPhoneReplies.clear();
  optedOutReminders.clear();
}

async function findOrCreateConversation(db: Db, worker: Worker) {
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.workerId, worker.id));
  if (existing.length > 0) return existing[0];
  const [conv] = await db
    .insert(conversations)
    .values({ workerId: worker.id, orgId: worker.orgId })
    .returning();
  return conv;
}

interface InboundMedia {
  kind: 'voice' | 'image' | 'none';
  transcript?: string;
  mediaUrl?: string;
}

async function processMedia(payload: InboundPayload, worker: Worker): Promise<InboundMedia> {
  const numMedia = Number(payload.NumMedia ?? '0');
  if (numMedia <= 0) return { kind: 'none' };
  const contentType = payload.MediaContentType0 ?? '';
  const mediaUrl = payload.MediaUrl0 ?? '';

  if (contentType.startsWith('audio/')) {
    // Mock mode: the simulator stands in for Whisper with MockTranscript.
    if (payload.MockTranscript !== undefined) {
      return { kind: 'voice', transcript: payload.MockTranscript.trim(), mediaUrl };
    }
    // Sandbox/production: download from Twilio (authenticated), convert, transcribe.
    const { buffer } = await downloadTwilioMedia(mediaUrl);
    const ext = contentType.includes('ogg') ? 'ogg' : 'audio';
    const rel = `${worker.orgId}/voice-in/${randomUUID()}.${ext}`;
    await saveBuffer(rel, buffer);
    const transcript = await transcribeAudio(absPath(rel), contentType);
    return { kind: 'voice', transcript, mediaUrl };
  }
  if (contentType.startsWith('image/')) {
    return { kind: 'image', mediaUrl };
  }
  return { kind: 'none' };
}

async function orgName(db: Db, orgId: string): Promise<string> {
  const [org] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
  return org?.name ?? 'tu lechería';
}

/** Send the one-time first-contact disclosure if this worker never got it. */
async function sendDisclosureIfNeeded(db: Db, worker: Worker): Promise<void> {
  if (!needsDisclosure(worker)) return;
  const sent = await sendToWorker(db, worker.id, {
    text: ES.disclosure(await orgName(db, worker.orgId), config().rawContentRetentionDays),
    kind: 'consent',
  });
  if (sent.ok) {
    const now = new Date();
    await markDisclosureSent(db, worker.id, now);
    worker.disclosureSentAt = now;
  }
}

/**
 * ALTA / BAJA. The worker's own message is the consent signal, so this always
 * wins over every other route and is never rate-limited away.
 */
async function handleConsentKeyword(
  db: Db,
  worker: Worker,
  keyword: ConsentKeyword,
): Promise<void> {
  if (keyword === 'baja') {
    await optOutWorker(db, worker.id);
    worker.consentStatus = 'opted_out';
    await sendToWorker(db, worker.id, { text: ES.optOutConfirm, kind: 'consent' });
    return;
  }
  // ALTA — opt in (or re-join after BAJA).
  if (worker.consentStatus !== 'opted_in') {
    await optInWorker(db, worker.id, 'whatsapp_keyword');
    worker.consentStatus = 'opted_in';
  }
  await sendDisclosureIfNeeded(db, worker);
  await sendToWorker(db, worker.id, { text: ES.optInConfirm, kind: 'consent' });
}

/**
 * The inbound pipeline (runs as a pg-boss job — the webhook returns 200
 * immediately). Resolves the worker, handles consent (ALTA/BAJA) and the
 * one-time disclosure, opens the 24h window, transcribes voice notes,
 * handles agreement signatures (ACEPTO), routes, answers, replies
 * (text + voice), and logs training events.
 */
export async function processInbound(db: Db, payload: InboundPayload): Promise<void> {
  const from = normalizeWhatsAppAddress(payload.From ?? '');
  if (!from) return;

  // Phone uniqueness is org-scoped, so one number can exist at two dairies on
  // the same deployment (worker moved between co-op farms; consultant demos).
  // The inbound webhook only knows the phone, so pick deterministically: the
  // active record with the most recent inbound activity, else the newest.
  const candidates = await db
    .select()
    .from(workers)
    .where(and(eq(workers.phoneE164, from), eq(workers.status, 'active')));
  const [worker] = candidates.sort(
    (a, b) =>
      (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  if (!worker) {
    const last = unknownPhoneReplies.get(from) ?? 0;
    if (Date.now() - last > 24 * 3600_000) {
      unknownPhoneReplies.set(from, Date.now());
      await getTransport().send({ to: from, body: ES.unregistered });
    }
    console.log(`↩︎ inbound from unregistered number ${maskPhone(from)} — ignored`);
    return;
  }

  // Text consent keywords bypass the rate limiter: an opt-out must never be
  // dropped by flood control (voice-note consent goes through the normal path).
  const textKeyword = parseConsentKeyword(payload.Body ?? '');

  if (!textKeyword) {
    const rate = checkRateLimit(worker.id);
    if (!rate.allowed) {
      if (rate.shouldWarn) {
        // They just messaged us, so the window is open for the warning.
        await db
          .update(workers)
          .set({ lastInboundAt: new Date(), updatedAt: new Date() })
          .where(eq(workers.id, worker.id));
        await sendToWorker(db, worker.id, { text: ES.slowDown, kind: 'reply' });
      }
      return;
    }
  }

  // Opening/extending the 24-hour window happens FIRST — replies depend on it.
  const now = new Date();
  await db
    .update(workers)
    .set({ lastInboundAt: now, updatedAt: now })
    .where(eq(workers.id, worker.id));
  worker.lastInboundAt = now;

  const conv = await findOrCreateConversation(db, worker);
  const media = await processMedia(payload, worker);
  const wasVoice = media.kind === 'voice';
  const text = wasVoice ? (media.transcript ?? '') : (payload.Body ?? '');

  await db.insert(messages).values({
    conversationId: conv.id,
    orgId: worker.orgId,
    direction: 'inbound',
    type: media.kind === 'none' ? 'text' : media.kind,
    bodyText: media.kind === 'none' ? text : null,
    transcriptText: wasVoice ? text : null,
    mediaUrl: media.mediaUrl ?? null,
    twilioSid: payload.MessageSid ?? null,
    status: 'received',
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conv.id));

  // ── Consent first: ALTA/BAJA always win, even mid-onboarding ──────────────
  const keyword = textKeyword ?? parseConsentKeyword(text);
  if (keyword) {
    await handleConsentKeyword(db, worker, keyword);
    return;
  }

  // ── Worker data deletion (BORRAR MIS DATOS): a data right, honored in any
  // consent state (including opted_out, hence before that early return).
  // Request → plain-language confirmation; SI BORRAR inside the window →
  // irreversible redaction. An unconfirmed request quietly expires.
  if (isDeletionRequest(text)) {
    await db
      .update(workers)
      .set({ deletionRequestedAt: now, updatedAt: now })
      .where(eq(workers.id, worker.id));
    await sendToWorker(db, worker.id, { text: ES.deletionConfirmPrompt, kind: 'consent' });
    return;
  }
  if (isDeletionConfirm(text)) {
    const requestedAt = worker.deletionRequestedAt;
    if (requestedAt && now.getTime() - requestedAt.getTime() <= DELETION_CONFIRM_WINDOW_MS) {
      // Confirm to the worker BEFORE the phone is tombstoned (the redaction
      // then nulls this message's stored body along with everything else).
      await sendToWorker(db, worker.id, { text: ES.deletionDone, kind: 'consent' });
      await deleteWorkerData(db, worker.id);
      return;
    }
    // Expired or never requested — re-explain instead of silently deleting.
    await db
      .update(workers)
      .set({ deletionRequestedAt: now, updatedAt: now })
      .where(eq(workers.id, worker.id));
    await sendToWorker(db, worker.id, { text: ES.deletionConfirmPrompt, kind: 'consent' });
    return;
  }

  // Opted-out workers are not processed: remind them how to re-join, at most
  // once a day, and otherwise stay silent (their BAJA is honored).
  if (worker.consentStatus === 'opted_out') {
    const last = optedOutReminders.get(worker.id) ?? 0;
    if (Date.now() - last > 24 * 3600_000) {
      optedOutReminders.set(worker.id, Date.now());
      await sendToWorker(db, worker.id, { text: ES.optedOutReminder, kind: 'consent' });
    }
    return;
  }

  // A pending worker chose to message us — that choice is the opt-in.
  if (worker.consentStatus === 'pending') {
    await optInWorker(db, worker.id, 'whatsapp_keyword', undefined, now);
    worker.consentStatus = 'opted_in';
  }

  // One-time disclosure goes out before any other reply.
  await sendDisclosureIfNeeded(db, worker);

  if (media.kind === 'image') {
    await sendToWorker(db, worker.id, { text: ES.imageNotSupported, kind: 'reply' });
    return;
  }

  // ── Cow care agreement: deliver if queued; match ACEPTO if delivered ──────
  // A message that just triggered delivery can't itself be a reply TO the
  // agreement — skip ACEPTO matching/nudges for it.
  const agreementJustDelivered = await deliverPendingAgreement(db, worker);
  if (!agreementJustDelivered && worker.pendingAgreementId && worker.pendingAgreementSentAt) {
    if (isAceptoReply(text)) {
      const [agreement] = await db
        .select()
        .from(agreements)
        .where(eq(agreements.id, worker.pendingAgreementId));
      if (agreement) {
        const sig = await recordSignature(db, {
          orgId: worker.orgId,
          workerId: worker.id,
          agreementId: agreement.id,
          agreementVersion: agreement.version,
          method: 'whatsapp',
          signedAt: now,
        });
        worker.pendingAgreementId = null;
        await sendToWorker(db, worker.id, {
          text: ES.agreementSigned(sig.agreementVersion),
          kind: 'reply',
        });
      }
      return;
    }
    // Not ACEPTO: one gentle clarification, then escalate to the manager and
    // stop nagging — the message itself still gets processed normally below.
    if (worker.pendingAgreementNudges === 0) {
      await db
        .update(workers)
        .set({ pendingAgreementNudges: 1, updatedAt: now })
        .where(eq(workers.id, worker.id));
      await sendToWorker(db, worker.id, { text: ES.agreementClarify, kind: 'reply' });
    } else {
      await db
        .update(workers)
        .set({
          pendingAgreementId: null,
          pendingAgreementSentAt: null,
          pendingAgreementNudges: 0,
          updatedAt: now,
        })
        .where(eq(workers.id, worker.id));
      await db.insert(escalations).values({
        orgId: worker.orgId,
        workerId: worker.id,
        questionText: text.slice(0, 500),
        reason: 'No confirmó el acuerdo de cuidado de las vacas (sin ACEPTO)',
      });
      await sendToWorker(db, worker.id, { text: ES.agreementEscalated, kind: 'reply' });
    }
  }

  // The window just (re)opened — deliver any modules waiting on the template
  // handshake before handling the message itself.
  const deliveredNow = await deliverNotifiedModules(db, worker.id);

  const pending = await findPendingCheck(db, worker.id);
  const route = routeInbound({
    text,
    pendingCheckOptions: pending ? pending.module.checkOptionsEs : null,
  });

  switch (route.kind) {
    case 'empty': {
      if (wasVoice) {
        await sendToWorker(db, worker.id, {
          text: 'No te escuché bien 🙏 ¿Me lo puedes mandar otra vez?',
          kind: 'reply',
        });
      }
      return;
    }
    case 'check_answer': {
      await handleCheckAnswer(db, pending!, route.checkIndex!, { wasVoice });
      return;
    }
    case 'ok_ack': {
      // If the OK was the template handshake, the module above was the reply.
      if (deliveredNow > 0) return;
      await sendToWorker(db, worker.id, {
        text: '👍 Aquí ando. Mándame tu pregunta por texto o audio cuando quieras.',
        kind: 'reply',
      });
      return;
    }
    case 'greeting': {
      const name = worker.name.split(/\s+/)[0] ?? worker.name;
      await sendToWorker(db, worker.id, { text: ES.greeting(name), kind: 'reply' });
      return;
    }
    case 'help': {
      await db.insert(escalations).values({
        orgId: worker.orgId,
        workerId: worker.id,
        questionText: text,
        reason: 'El trabajador pidió ayuda directamente',
      });
      await logTrainingEvent(db, {
        orgId: worker.orgId,
        workerId: worker.id,
        eventType: 'escalation',
        topic: 'Otro',
        farmTopic: 'none',
        questionText: text,
        confidence: 'not_found',
      });
      await sendToWorker(db, worker.id, { text: ES.helpEscalated, kind: 'reply' });
      return;
    }
    case 'question': {
      // Non-Spanish free-form question → a warm Spanish nudge instead of
      // running retrieval (which would return the Spanish "no encontré eso" as
      // if it were a knowledge gap). Logged as a normal interaction, never an
      // escalation. Runs only here, so ALTA/BAJA/ACEPTO/OK/numeric answers are
      // already handled above and never intercepted. Forbidden-topic text is
      // exempt: it must fall through to answerQuestion(), whose guard refuses
      // and escalates — otherwise an English "when do you pay me" would get
      // the language nudge and never reach a human.
      if (!looksSpanish(text) && !matchForbiddenTopic(text)) {
        await sendToWorker(db, worker.id, { text: ES.spanishOnly, kind: 'reply' });
        await logTrainingEvent(db, {
          orgId: worker.orgId,
          workerId: worker.id,
          eventType: 'qa_interaction',
          topic: 'Otro',
          farmTopic: 'none',
          questionText: text,
          answerText: ES.spanishOnly,
          confidence: null,
        });
        return;
      }

      const result = await answerQuestion(db, worker.orgId, text);
      const audio = wasVoice ? await synthesizeSpeech(ttsVariant(result.text)) : null;
      await sendToWorker(db, worker.id, {
        text: result.text,
        audioUrl: audio?.publicUrl,
        kind: 'reply',
      });

      // Immigration/legal guard hits: the worker's exact words never enter
      // employer-visible records (the escalation row, both training events,
      // and therefore the audit-pack CSV) — only a category marker does.
      // Employment and medical_dosing stay verbatim on purpose: a wage or
      // dosing question is not the same risk class as a worker revealing
      // fear about their status.
      const redactCategory =
        result.forbiddenCategory === 'immigration' || result.forbiddenCategory === 'legal'
          ? result.forbiddenCategory
          : null;
      const recordedQuestion = redactCategory
        ? `Tema restringido: ${redactCategory === 'immigration' ? 'migración' : 'legal'}`
        : text;

      const farmTopic = mapToFarmTopic(result.topic, text);
      await logTrainingEvent(db, {
        orgId: worker.orgId,
        workerId: worker.id,
        eventType: 'qa_interaction',
        topic: result.topic,
        farmTopic,
        questionText: recordedQuestion,
        answerText: result.text,
        sourceDocumentId: result.sourceDocumentId,
        sourceChunkIds: result.sourceChunkIds.length > 0 ? result.sourceChunkIds : null,
        confidence: result.confidence,
      });

      if (result.forbidden || result.confidence === 'not_found') {
        await db.insert(escalations).values({
          orgId: worker.orgId,
          workerId: worker.id,
          questionText: recordedQuestion,
          reason: result.forbidden
            ? 'Tema restringido (sueldo/legal/migración/dosis)'
            : 'No encontrado en los SOPs',
        });
        await logTrainingEvent(db, {
          orgId: worker.orgId,
          workerId: worker.id,
          eventType: 'escalation',
          topic: result.topic,
          farmTopic,
          questionText: recordedQuestion,
          confidence: 'not_found',
        });
      }
      return;
    }
  }
}
