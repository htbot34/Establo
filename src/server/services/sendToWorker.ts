import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conversations, messages, orgs, workers } from '../db/schema.js';
import { config } from '../config.js';
import { maskPhone } from '../lib/phone.js';
import { renderTemplate, type TemplateName } from './messages.es.js';
import { getSmsFallbackTransport, getTransport } from './transport.js';
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

/**
 * Who initiated this send? Consent gating depends on it:
 *   'business' — Establo/the employer initiated (drip lessons, reminders,
 *                templates, agreement requests). Requires the worker to be
 *                opted_in. THE DEFAULT — callers must opt INTO 'reply'.
 *   'reply'    — direct response to a message the worker just sent. Allowed
 *                unless the worker opted out.
 *   'consent'  — the consent flow itself (opt-out confirmation, disclosure,
 *                re-join confirmation). Always allowed; Meta requires
 *                opt-outs to be confirmed.
 */
export type SendKind = 'business' | 'reply' | 'consent';

export interface OutboundPayload {
  text: string;
  /** Public URL path of a voice note to send alongside (e.g. /media/audio/x.ogg) */
  audioUrl?: string;
  /** Template sends are allowed outside the 24h window. */
  template?: { name: TemplateName; vars: string[] };
  kind?: SendKind;
}

export type SendRefusalReason =
  | 'window_closed'
  | 'worker_not_found'
  | 'not_opted_in'
  | 'templates_paused';

export type SendOutcome =
  | { ok: true; messageIds: string[]; sids: string[] }
  | { ok: false; reason: SendRefusalReason; messageIds: [] };

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
 * reminders, agreements, system notices) sends through here so policy is
 * enforced in exactly one place:
 *   1. Consent gate (Meta opt-in policy): business-initiated sends require
 *      consent_status = 'opted_in'; replies are allowed unless opted_out;
 *      consent-flow messages always go (opt-outs must be confirmed).
 *   2. Template pause: when a template/category-policy failure was detected,
 *      ALL template sends for the org are refused until an owner
 *      acknowledges — never silently retried. (SMS fallback seam lives here.)
 *   3. 24h window (Meta policy): window open → free-form allowed; closed →
 *      only templates, free-form is rejected with "window_closed" so the
 *      caller can fall back to the template handshake.
 */
export async function sendToWorker(
  db: Db,
  workerId: string,
  payload: OutboundPayload,
  now: Date = new Date(),
): Promise<SendOutcome> {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId));
  if (!worker) return { ok: false, reason: 'worker_not_found', messageIds: [] };

  const kind: SendKind = payload.kind ?? 'business';
  if (kind !== 'consent') {
    const blocked =
      kind === 'business'
        ? worker.consentStatus !== 'opted_in'
        : worker.consentStatus === 'opted_out';
    if (blocked) return { ok: false, reason: 'not_opted_in', messageIds: [] };
  }

  const isTemplate = !!payload.template;
  if (isTemplate) {
    const [org] = await db
      .select({ pausedAt: orgs.templateSendsPausedAt })
      .from(orgs)
      .where(eq(orgs.id, worker.orgId));
    if (org?.pausedAt) {
      // SMS fallback seam: when templates are down, a real SMS transport
      // could carry the notification instead. Stub-only for now.
      if (config().smsFallbackEnabled) {
        await getSmsFallbackTransport().send({
          to: worker.phoneE164,
          body: renderTemplate(payload.template!.name, payload.template!.vars),
        });
      }
      return { ok: false, reason: 'templates_paused', messageIds: [] };
    }
  }

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
