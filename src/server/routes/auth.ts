import { createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { getDb } from '../db/client.js';
import { orgs, users } from '../db/schema.js';
import { clearSession, establishSession, resolveSession } from '../auth/session.js';
import { isAuthThrottled, recordAuthFailure } from '../services/rateLimit.js';

const setupSchema = z.object({
  orgName: z.string().min(2).max(120),
  timezone: z.string().min(1).max(64).default('America/Boise'),
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  setupToken: z.string().max(200).optional(),
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

/** Constant-time token compare (hash both sides so lengths never leak). */
function tokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// A fixed argon2 hash to verify against when the login email doesn't exist,
// so a failed lookup and a failed password check take comparable time (no
// user-enumeration timing oracle). Built lazily once per process.
let dummyHash: string | undefined;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await argon2.hash('establo-timing-oracle-dummy');
  return dummyHash;
}

function throttleKey(req: FastifyRequest, bucket: 'login' | 'setup'): string {
  return `${bucket}:${req.ip}`;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * Org setup: creates a new org + its owner account. Gated by SETUP_TOKEN on
   * EVERY call — this is a multi-tenant instance, so "lock once a user
   * exists" would block onboarding the second dairy; a token required every
   * time is safe under both deployment models. Unset token → setup disabled.
   */
  app.post('/api/auth/setup', async (req, reply) => {
    const key = throttleKey(req, 'setup');
    if (isAuthThrottled(key)) {
      return reply.code(429).send({ error: 'Too many attempts — try again later' });
    }
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const provided =
      parsed.data.setupToken ?? (req.headers['x-setup-token'] as string | undefined);
    if (!tokenMatches(provided, config().setupToken)) {
      recordAuthFailure(key);
      return reply.code(403).send({
        error: 'A valid setup token is required to create a new dairy (ask your Establo contact)',
      });
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
    const key = throttleKey(req, 'login');
    if (isAuthThrottled(key)) {
      return reply.code(429).send({ error: 'Too many attempts — try again later' });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Email and password required' });
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
    // Always run one argon2 verification, against a dummy hash when the email
    // doesn't exist — the response time must not reveal which factor failed.
    const passwordOk = await argon2.verify(
      user?.passwordHash ?? (await getDummyHash()),
      parsed.data.password,
    );
    if (!user || !passwordOk) {
      recordAuthFailure(key);
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
