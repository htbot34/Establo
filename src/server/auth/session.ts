import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { orgs, users, type Org, type User } from '../db/schema.js';
import { config } from '../config.js';

const SESSION_COOKIE = 'establo_session';
const CSRF_COOKIE = 'establo_csrf';
const SESSION_TTL_MS = 7 * 24 * 3600_000;

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: User;
    authOrg?: Org;
  }
}

interface SessionData {
  uid: string;
  exp: number;
}

export function establishSession(reply: FastifyReply, userId: string): void {
  const data: SessionData = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  const secure = config().isProduction;
  reply.setCookie(SESSION_COOKIE, JSON.stringify(data), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
  // Double-submit CSRF token: readable by the SPA, echoed in x-csrf-token.
  reply.setCookie(CSRF_COOKIE, randomBytes(24).toString('hex'), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export async function resolveSession(req: FastifyRequest): Promise<{ user: User; org: Org } | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  let data: SessionData;
  try {
    data = JSON.parse(unsigned.value) as SessionData;
  } catch {
    return null;
  }
  if (!data.uid || data.exp < Date.now()) return null;
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, data.uid));
  if (!user) return null;
  const [org] = await db.select().from(orgs).where(eq(orgs.id, user.orgId));
  if (!org) return null;
  return { user, org };
}

/**
 * preHandler for all dashboard API routes: requires a valid session and, for
 * mutating methods, a matching CSRF double-submit token.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await resolveSession(req);
  if (!session) {
    reply.code(401).send({ error: 'Not authenticated' });
    return reply;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const header = req.headers['x-csrf-token'];
    const cookie = req.cookies[CSRF_COOKIE];
    if (!header || !cookie || header !== cookie) {
      reply.code(403).send({ error: 'CSRF token missing or invalid' });
      return reply;
    }
  }
  req.authUser = session.user;
  req.authOrg = session.org;
}
