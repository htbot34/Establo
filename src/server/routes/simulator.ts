import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { getDb } from '../db/client.js';
import { conversations, messages, webhookLogs, workers } from '../db/schema.js';
import { dispatch } from '../jobs/boss.js';
import { runDripTick } from '../services/drip.js';
import type { InboundPayload } from '../services/inbound.js';

/**
 * MOCK_MODE-only simulator API. The simulator page is a phone-styled chat UI
 * that stands in for WhatsApp: messages submitted here run through the EXACT
 * same webhook payload shape, job queue, router, and answer pipeline as real
 * Twilio traffic — only the transport is mocked.
 */
export function registerSimulatorRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', requireAuth);

  app.get('/api/simulator/workers', async (req) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(workers)
      .where(and(eq(workers.orgId, req.authOrg!.id), eq(workers.status, 'active')))
      .orderBy(asc(workers.name));
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      phoneE164: w.phoneE164,
      lastInboundAt: w.lastInboundAt,
      consentStatus: w.consentStatus,
      pendingAgreement: !!(w.pendingAgreementId && w.pendingAgreementSentAt),
    }));
  });

  /** Send a message AS a worker (text, or a "voice note" whose transcript you type). */
  app.post('/api/simulator/inbound', async (req, reply) => {
    const body = z
      .object({
        workerId: z.string().uuid(),
        kind: z.enum(['text', 'voice']),
        text: z.string().min(1).max(2000),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'workerId, kind, text required' });

    const db = getDb();
    const [worker] = await db
      .select()
      .from(workers)
      .where(and(eq(workers.id, body.data.workerId), eq(workers.orgId, req.authOrg!.id)));
    if (!worker) return reply.code(404).send({ error: 'Worker not found' });

    // Same payload shape Twilio would POST to /webhooks/twilio.
    const payload: InboundPayload =
      body.data.kind === 'voice'
        ? {
            From: `whatsapp:${worker.phoneE164}`,
            Body: '',
            NumMedia: '1',
            MediaContentType0: 'audio/ogg',
            MediaUrl0: 'mock://simulator-voice-note',
            MockTranscript: body.data.text,
            MessageSid: `SIM${Date.now()}`,
          }
        : {
            From: `whatsapp:${worker.phoneE164}`,
            Body: body.data.text,
            NumMedia: '0',
            MessageSid: `SIM${Date.now()}`,
          };

    const [logRow] = await db
      .insert(webhookLogs)
      .values({ payload, signatureValid: null, processed: false })
      .returning({ id: webhookLogs.id });
    await dispatch('inbound-message', { payload, webhookLogId: logRow.id });
    return { ok: true };
  });

  /** Poll the simulated conversation (the phone screen). */
  app.get<{ Params: { workerId: string } }>(
    '/api/simulator/conversation/:workerId',
    async (req, reply) => {
      const db = getDb();
      const [worker] = await db
        .select()
        .from(workers)
        .where(and(eq(workers.id, req.params.workerId), eq(workers.orgId, req.authOrg!.id)));
      if (!worker) return reply.code(404).send({ error: 'Worker not found' });
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.workerId, worker.id));
      if (!conv) return { workerId: worker.id, lastInboundAt: worker.lastInboundAt, messages: [] };
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt))
        .limit(300);
      return { workerId: worker.id, lastInboundAt: worker.lastInboundAt, messages: msgs };
    },
  );

  /** Run the drip scheduler right now (instead of waiting for the cron). */
  app.post('/api/simulator/run-drip', async () => {
    return runDripTick(getDb());
  });

  /**
   * Time-travel: pretend the worker last wrote >24h ago, so the next drip
   * delivery exercises the template-handshake path.
   */
  app.post('/api/simulator/close-window', async (req, reply) => {
    const body = z.object({ workerId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'workerId required' });
    const db = getDb();
    const [row] = await db
      .update(workers)
      .set({ lastInboundAt: new Date(Date.now() - 25 * 3600_000), updatedAt: new Date() })
      .where(and(eq(workers.id, body.data.workerId), eq(workers.orgId, req.authOrg!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Worker not found' });
    return { ok: true, lastInboundAt: row.lastInboundAt };
  });
}
