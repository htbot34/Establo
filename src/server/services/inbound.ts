import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, escalations, messages, workers, type Worker } from '../db/schema.js';
import { config } from '../config.js';
import { maskPhone, normalizeWhatsAppAddress } from '../lib/phone.js';
import { absPath, saveBuffer } from '../lib/storage.js';
import { answerQuestion } from './answer.js';
import { deliverNotifiedModules, findPendingCheck, handleCheckAnswer, ttsVariant } from './drip.js';
import { ES } from './messages.es.js';
import { checkRateLimit } from './rateLimit.js';
import { routeInbound } from './router.js';
import { sendToWorker } from './sendToWorker.js';
import { synthesizeSpeech, transcribeAudio } from './speech.js';
import { logTrainingEvent } from './trainingEvents.js';
import { downloadTwilioMedia, getTransport } from './transport.js';

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

/**
 * The inbound pipeline (runs as a pg-boss job — the webhook returns 200
 * immediately). Resolves the worker, opens the 24h window, transcribes voice
 * notes, routes, answers, replies (text + voice), and logs training events.
 */
export async function processInbound(db: Db, payload: InboundPayload): Promise<void> {
  const from = normalizeWhatsAppAddress(payload.From ?? '');
  if (!from) return;

  const [worker] = await db.select().from(workers).where(eq(workers.phoneE164, from));
  if (!worker || worker.status !== 'active') {
    const last = unknownPhoneReplies.get(from) ?? 0;
    if (Date.now() - last > 24 * 3600_000) {
      unknownPhoneReplies.set(from, Date.now());
      await getTransport().send({ to: from, body: ES.unregistered });
    }
    console.log(`↩︎ inbound from unregistered number ${maskPhone(from)} — ignored`);
    return;
  }

  const rate = checkRateLimit(worker.id);
  if (!rate.allowed) {
    if (rate.shouldWarn) {
      // They just messaged us, so the window is open for the warning.
      await db
        .update(workers)
        .set({ lastInboundAt: new Date(), updatedAt: new Date() })
        .where(eq(workers.id, worker.id));
      await sendToWorker(db, worker.id, { text: ES.slowDown });
    }
    return;
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

  if (media.kind === 'image') {
    await sendToWorker(db, worker.id, { text: ES.imageNotSupported });
    return;
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
      });
      return;
    }
    case 'greeting': {
      const name = worker.name.split(/\s+/)[0] ?? worker.name;
      await sendToWorker(db, worker.id, { text: ES.greeting(name) });
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
        questionText: text,
        confidence: 'not_found',
      });
      await sendToWorker(db, worker.id, { text: ES.helpEscalated });
      return;
    }
    case 'question': {
      const result = await answerQuestion(db, worker.orgId, text);
      const audio = wasVoice ? await synthesizeSpeech(ttsVariant(result.text)) : null;
      await sendToWorker(db, worker.id, { text: result.text, audioUrl: audio?.publicUrl });

      await logTrainingEvent(db, {
        orgId: worker.orgId,
        workerId: worker.id,
        eventType: 'qa_interaction',
        topic: result.topic,
        questionText: text,
        answerText: result.text,
        sourceDocumentId: result.sourceDocumentId,
        sourceChunkIds: result.sourceChunkIds.length > 0 ? result.sourceChunkIds : null,
        confidence: result.confidence,
      });

      if (result.forbidden || result.confidence === 'not_found') {
        await db.insert(escalations).values({
          orgId: worker.orgId,
          workerId: worker.id,
          questionText: text,
          reason: result.forbidden
            ? 'Tema restringido (sueldo/legal/migración/dosis)'
            : 'No encontrado en los SOPs',
        });
        await logTrainingEvent(db, {
          orgId: worker.orgId,
          workerId: worker.id,
          eventType: 'escalation',
          topic: result.topic,
          questionText: text,
          confidence: 'not_found',
        });
      }
      return;
    }
  }
}
