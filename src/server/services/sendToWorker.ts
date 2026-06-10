import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages, workers } from '../db/schema.js';
import { config } from '../config.js';
import { maskPhone } from '../lib/phone.js';
import { renderTemplate, type TemplateName } from './messages.es.js';
import { getTransport } from './transport.js';
import { windowState } from './window.js';

export const MAX_SEGMENT_CHARS = 1200;

/** Split long text on paragraph → sentence boundaries into ≤max segments. */
export function splitMessage(text: string, max: number = MAX_SEGMENT_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) return [trimmed];
  const segments: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) segments.push(current.trim());
    current = '';
  };
  const pieces = trimmed
    .split(/\n\n+/)
    .flatMap((p) => (p.length <= max ? [p] : p.split(/(?<=[.!?])\s+/)));
  for (const piece of pieces) {
    if (current.length + piece.length + 2 > max) push();
    if (piece.length > max) {
      // pathological: hard-split
      for (let i = 0; i < piece.length; i += max) segments.push(piece.slice(i, i + max));
      continue;
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  push();
  return segments;
}

export interface OutboundPayload {
  text: string;
  /** Public URL path of a voice note to send alongside (e.g. /media/audio/x.ogg) */
  audioUrl?: string;
  /** Template sends are allowed outside the 24h window. */
  template?: { name: TemplateName; vars: string[] };
}

export type SendOutcome =
  | { ok: true; messageIds: string[]; sids: string[] }
  | { ok: false; reason: 'window_closed' | 'worker_not_found'; messageIds: [] };

async function findOrCreateConversation(db: Db, workerId: string, orgId: string) {
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.workerId, workerId));
  if (existing.length > 0) return existing[0];
  const [conv] = await db
    .insert(conversations)
    .values({ workerId, orgId })
    .returning();
  return conv;
}

/**
 * THE single outbound door. Every flow (Q&A replies, drip modules,
 * reminders, system notices) sends through here so the WhatsApp 24-hour
 * window policy is enforced in exactly one place:
 *   - window open   → free-form sends allowed
 *   - window closed → only template sends go out; free-form attempts are
 *                     rejected with reason "window_closed" so the caller can
 *                     fall back to a template handshake.
 */
export async function sendToWorker(
  db: Db,
  workerId: string,
  payload: OutboundPayload,
  now: Date = new Date(),
): Promise<SendOutcome> {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId));
  if (!worker) return { ok: false, reason: 'worker_not_found', messageIds: [] };

  const isTemplate = !!payload.template;
  if (!isTemplate && windowState(worker.lastInboundAt, now) === 'closed') {
    return { ok: false, reason: 'window_closed', messageIds: [] };
  }

  const conv = await findOrCreateConversation(db, worker.id, worker.orgId);
  const transport = getTransport();
  const text = payload.template
    ? renderTemplate(payload.template.name, payload.template.vars)
    : payload.text;

  const messageIds: string[] = [];
  const sids: string[] = [];

  for (const segment of splitMessage(text)) {
    const { sid, status } = await transport.send({ to: worker.phoneE164, body: segment });
    const [row] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        orgId: worker.orgId,
        direction: 'outbound',
        type: isTemplate ? 'template' : 'text',
        bodyText: segment,
        twilioSid: sid,
        status,
      })
      .returning({ id: messages.id });
    messageIds.push(row.id);
    sids.push(sid);
  }

  if (payload.audioUrl && !isTemplate) {
    const absoluteUrl = `${config().publicBaseUrl}${payload.audioUrl}`;
    const { sid, status } = await transport.send({
      to: worker.phoneE164,
      mediaUrl: absoluteUrl,
    });
    const [row] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        orgId: worker.orgId,
        direction: 'outbound',
        type: 'voice',
        audioReplyUrl: payload.audioUrl,
        twilioSid: sid,
        status,
      })
      .returning({ id: messages.id });
    messageIds.push(row.id);
    sids.push(sid);
  }

  await db
    .update(conversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(conversations.id, conv.id));

  if (config().runMode !== 'production') {
    console.log(
      `→ [${transport.name}] to ${maskPhone(worker.phoneE164)}: ${text.slice(0, 80).replace(/\n/g, ' ')}${text.length > 80 ? '…' : ''}`,
    );
  }
  return { ok: true, messageIds, sids };
}
