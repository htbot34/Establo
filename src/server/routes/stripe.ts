import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { orgs } from '../db/schema.js';
import { config } from '../config.js';

/**
 * Stripe webhook (feature-flagged with ENABLE_BILLING). Registered in its own
 * plugin scope so the raw body is preserved for signature verification.
 */
export function registerStripeRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );

    scope.post('/webhooks/stripe', async (req, reply) => {
      const cfg = config();
      if (!cfg.enableBilling || !cfg.stripeWebhookSecret) {
        return reply.code(404).send({ error: 'Billing not enabled' });
      }
      const raw = req.body as string;
      const header = (req.headers['stripe-signature'] as string | undefined) ?? '';
      const parts = Object.fromEntries(
        header.split(',').map((p) => p.split('=') as [string, string]),
      );
      const timestamp = parts.t;
      const signature = parts.v1;
      if (!timestamp || !signature) return reply.code(400).send({ error: 'Bad signature header' });
      const expected = createHmac('sha256', cfg.stripeWebhookSecret)
        .update(`${timestamp}.${raw}`)
        .digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return reply.code(400).send({ error: 'Invalid signature' });
      }

      const event = JSON.parse(raw) as {
        type: string;
        data: { object: { metadata?: { orgId?: string }; status?: string } };
      };
      const orgId = event.data.object.metadata?.orgId;
      if (orgId) {
        const db = getDb();
        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
        if (org) {
          const settings = { ...(org.settings as Record<string, unknown>) };
          if (event.type === 'checkout.session.completed') {
            settings.billing = { active: true, activatedAt: new Date().toISOString() };
          } else if (
            event.type === 'customer.subscription.deleted' ||
            event.type === 'customer.subscription.paused'
          ) {
            settings.billing = { active: false, deactivatedAt: new Date().toISOString() };
          }
          await db
            .update(orgs)
            .set({ settings, updatedAt: new Date() })
            .where(eq(orgs.id, orgId));
        }
      }
      return { received: true };
    });
  });
}
