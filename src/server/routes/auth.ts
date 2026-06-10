import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { orgs, users } from '../db/schema.js';
import { clearSession, establishSession, resolveSession } from '../auth/session.js';

const setupSchema = z.object({
  orgName: z.string().min(2).max(120),
  timezone: z.string().min(1).max(64).default('America/Boise'),
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

function publicUser(u: { id: string; email: string; name: string; role: string }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
function publicOrg(o: {
  id: string;
  name: string;
  timezone: string;
  herdSize: number | null;
  locale: string;
}) {
  return { id: o.id, name: o.name, timezone: o.timezone, herdSize: o.herdSize, locale: o.locale };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  /** First-run org setup: creates a new org + its owner account. */
  app.post('/api/auth/setup', async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.email, parsed.data.email));
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'An account with that email already exists' });
    }
    const [org] = await db
      .insert(orgs)
      .values({ name: parsed.data.orgName, timezone: parsed.data.timezone })
      .returning();
    const [user] = await db
      .insert(users)
      .values({
        orgId: org.id,
        email: parsed.data.email,
        passwordHash: await argon2.hash(parsed.data.password),
        role: 'owner',
        name: parsed.data.name,
      })
      .returning();
    establishSession(reply, user.id);
    return { user: publicUser(user), org: publicOrg(org) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Email and password required' });
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: 'Incorrect email or password' });
    }
    const [org] = await db.select().from(orgs).where(eq(orgs.id, user.orgId));
    establishSession(reply, user.id);
    return { user: publicUser(user), org: publicOrg(org) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const session = await resolveSession(req);
    if (!session) return reply.code(401).send({ error: 'Not authenticated' });
    return { user: publicUser(session.user), org: publicOrg(session.org) };
  });
}
