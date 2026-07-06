/**
 * Security hardening integration tests: the SETUP_TOKEN gate on org setup
 * (multi-tenant — required on EVERY call, no "first user" exception), the
 * login/setup failure throttle, and the login timing-oracle mitigation
 * (behavioral part only; the timing itself isn't asserted).
 */
import { createHmac } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import { resetConfigForTests } from '../../src/server/config.js';
import { orgs, users } from '../../src/server/db/schema.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;
const SETUP_TOKEN = 'test-setup-token-42';

let app: FastifyInstance;
let db: Db;

function setupPayload(email: string, extra: Record<string, unknown> = {}) {
  return {
    orgName: 'Security Dairy',
    timezone: 'America/Boise',
    name: 'Sec Owner',
    email,
    password: 'a-strong-password',
    ...extra,
  };
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS establo_test WITH (FORCE)');
  await admin.query('CREATE DATABASE establo_test');
  await admin.end();
  await runMigrations(TEST_URL);

  process.env.SETUP_TOKEN = SETUP_TOKEN;
  resetConfigForTests();
  resetRateLimits();
  db = getDb();
  app = await buildApp();
});

afterAll(async () => {
  delete process.env.SETUP_TOKEN;
  resetConfigForTests();
  await app?.close();
  await closeDb();
});

describe('SETUP_TOKEN gate on /api/auth/setup', () => {
  it('blocks setup without a token even when zero users exist', async () => {
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(0); // fresh database — the classic "first user" case
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: setupPayload('first@test.local'),
    });
    expect(res.statusCode).toBe(403);
    expect(await db.select().from(orgs)).toHaveLength(0);
  });

  it('blocks setup with a wrong token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: setupPayload('first@test.local', { setupToken: 'nope' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates the org with a valid token — and a SECOND org later (multi-tenant)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: setupPayload('first@test.local', { setupToken: SETUP_TOKEN }),
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).user.role).toBe('owner');

    // The gate must not be "lock after the first user": onboarding a second
    // dairy on the same deployment keeps working with the token.
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: setupPayload('second@test.local', { setupToken: SETUP_TOKEN }),
    });
    expect(second.statusCode).toBe(200);
    expect(await db.select().from(orgs)).toHaveLength(2);
  });

  it('refuses every setup when SETUP_TOKEN is unset (setup disabled)', async () => {
    delete process.env.SETUP_TOKEN;
    resetConfigForTests();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        // Even sending the previously-valid token fails: nothing to match.
        payload: setupPayload('third@test.local', { setupToken: SETUP_TOKEN }),
      });
      expect(res.statusCode).toBe(403);
    } finally {
      process.env.SETUP_TOKEN = SETUP_TOKEN;
      resetConfigForTests();
    }
  });
});

describe('auth failure throttling (per IP, failures only)', () => {
  it('throttles login after 10 failures from one IP; other IPs unaffected', async () => {
    await db.insert(users).values({
      orgId: (await db.select().from(orgs))[0].id,
      email: 'victim@test.local',
      passwordHash: await argon2.hash('correct-password'),
      role: 'owner',
      name: 'Victim',
    });

    const attempt = (ip: string, password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: { email: 'victim@test.local', password },
      });

    for (let i = 0; i < 10; i++) {
      const res = await attempt('10.9.9.1', `wrong-${i}`);
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Incorrect email or password');
    }
    // 11th attempt from the same IP is refused before verification — even
    // with the CORRECT password.
    const blocked = await attempt('10.9.9.1', 'correct-password');
    expect(blocked.statusCode).toBe(429);

    // A different IP with the right password still gets in.
    const ok = await attempt('10.9.9.2', 'correct-password');
    expect(ok.statusCode).toBe(200);
  });

  it('unknown email and wrong password return the identical generic error', async () => {
    const ghost = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.9.9.3' },
      payload: { email: 'nobody@test.local', password: 'whatever-here' },
    });
    const wrongPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '10.9.9.3' },
      payload: { email: 'victim@test.local', password: 'not-the-password' },
    });
    expect(ghost.statusCode).toBe(401);
    expect(wrongPw.statusCode).toBe(401);
    expect(JSON.parse(ghost.body)).toEqual(JSON.parse(wrongPw.body));
  });

  it('throttles setup-token guessing the same way', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { 'x-forwarded-for': '10.9.9.4' },
        payload: setupPayload('guess@test.local', { setupToken: `guess-${i}` }),
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'x-forwarded-for': '10.9.9.4' },
      payload: setupPayload('guess@test.local', { setupToken: SETUP_TOKEN }),
    });
    expect(blocked.statusCode).toBe(429);
  });
});

describe('Stripe webhook replay protection', () => {
  const STRIPE_SECRET = 'whsec_test_secret';

  function signedRequest(timestampSeconds: number) {
    const raw = JSON.stringify({ type: 'noop.event', data: { object: {} } });
    const sig = createHmac('sha256', STRIPE_SECRET)
      .update(`${timestampSeconds}.${raw}`)
      .digest('hex');
    return app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${timestampSeconds},v1=${sig}`,
      },
      payload: raw,
    });
  }

  it('rejects correctly-signed events older than 5 minutes; accepts fresh ones', async () => {
    process.env.ENABLE_BILLING = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
    resetConfigForTests();
    try {
      const stale = await signedRequest(Math.floor(Date.now() / 1000) - 6 * 60);
      expect(stale.statusCode).toBe(400);
      expect(JSON.parse(stale.body).error).toContain('Stale');

      const fresh = await signedRequest(Math.floor(Date.now() / 1000));
      expect(fresh.statusCode).toBe(200);
      expect(JSON.parse(fresh.body)).toEqual({ received: true });
    } finally {
      delete process.env.ENABLE_BILLING;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      resetConfigForTests();
    }
  });
});
