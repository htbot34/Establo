import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { messages, webhookLogs } from '../db/schema.js';
import { config } from '../config.js';
import { dispatch } from '../jobs/boss.js';
import type { InboundPayload } from '../services/inbound.js';
import { validateTwilioSignature } from '../services/twilioSignature.js';

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export function registerWebhookRoutes(app: FastifyInstance): void {
  /**
   * Twilio inbound WhatsApp webhook. Validates the signature (sandbox/prod),
   * logs the raw payload, enqueues processing, responds 200 immediately.
   */
  app.post('/webhooks/twilio', async (req, reply) => {
    const cfg = config();
    const params = (req.body ?? {}) as Record<string, string>;
    const db = getDb();

    let signatureValid: boolean | null = null;
    if (!cfg.isMock && cfg.twilioValidateSignature) {
      const url = `${cfg.publicBaseUrl}/webhooks/twilio`;
      signatureValid = validateTwilioSignature(
        cfg.twilioAuthToken ?? '',
        req.headers['x-twilio-signature'] as string | undefined,
        url,
        params,
      );
      if (!signatureValid) {
        await db.insert(webhookLogs).values({
          payload: params,
          signatureValid: false,
          processed: false,
          errorText: 'Invalid Twilio signature',
        });
        return reply.code(403).send({ error: 'Invalid signature' });
      }
    }

    const [logRow] = await db
      .insert(webhookLogs)
      .values({ payload: params, signatureValid, processed: false })
      .returning({ id: webhookLogs.id });

    await dispatch('inbound-message', {
      payload: params as InboundPayload,
      webhookLogId: logRow.id,
    });

    return reply.type('text/xml').send(TWIML_EMPTY);
  });

  /** Twilio delivery status callbacks — update message status, nothing else. */
  app.post('/webhooks/twilio/status', async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const sid = params.MessageSid ?? params.SmsSid;
    const status = params.MessageStatus ?? params.SmsStatus;
    if (sid && status) {
      await getDb()
        .update(messages)
        .set({ status, updatedAt: new Date() })
        .where(eq(messages.twilioSid, sid));
    }
    return reply.type('text/xml').send(TWIML_EMPTY);
  });
}
