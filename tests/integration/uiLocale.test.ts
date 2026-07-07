/**
 * uiLocale persistence: the users.ui_locale column defaults to 'en' (existing
 * dashboards unchanged), /api/auth/me exposes it, and PATCH /api/auth/me
 * persists a change — with the same session + CSRF discipline as every other
 * dashboard mutation.
 */
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import { resetConfigForTests } from '../../src/server/config.js';
import { users } from '../../src/server/db/schema.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;
const SETUP_TOKEN = 'test-setup-token-i18n';

let app: FastifyInstance;
let db: Db;
let sessionCookie = '';
let csrfCookie = '';

function authHeaders(withCsrf = true) {
  return {
    cookie: `establo_session=${encodeURIComponent(sessionCookie)}; establo_csrf=${csrfCookie}`,
    ...(withCsrf ? { 'x-csrf-token': csrfCookie } : {}),
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

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: {
      orgName: 'Locale Dairy',
      timezone: 'America/Boise',
      name: 'Locale Owner',
      email: 'locale@test.local',
      password: 'a-strong-password',
      setupToken: SETUP_TOKEN,
    },
  });
  expect(res.statusCode).toBe(200);
  sessionCookie = res.cookies.find((c) => c.name === 'establo_session')!.value;
  csrfCookie = res.cookies.find((c) => c.name === 'establo_csrf')!.value;
});

afterAll(async () => {
  delete process.env.SETUP_TOKEN;
  resetConfigForTests();
  await app?.close();
  await closeDb();
});

describe('uiLocale on the auth surface', () => {
  it("defaults to 'en' and is exposed on GET /api/auth/me", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeaders(false) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.uiLocale).toBe('en');
  });

  it('PATCH /api/auth/me persists the locale to the users row', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeaders(),
      payload: { uiLocale: 'es' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.uiLocale).toBe('es');

    // Persisted: a fresh GET and the DB row both agree.
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeaders(false) });
    expect(me.json().user.uiLocale).toBe('es');
    const [row] = await db.select().from(users).where(eq(users.email, 'locale@test.local'));
    expect(row.uiLocale).toBe('es');

    // And back, so the account ends in a known state.
    const back = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeaders(),
      payload: { uiLocale: 'en' },
    });
    expect(back.json().user.uiLocale).toBe('en');
  });

  it('rejects locales outside en/es', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeaders(),
      payload: { uiLocale: 'fr' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a session (401) and the CSRF double-submit token (403)', async () => {
    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { uiLocale: 'es' },
    });
    expect(anon.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: authHeaders(false),
      payload: { uiLocale: 'es' },
    });
    expect(noCsrf.statusCode).toBe(403);

    // Neither failure changed the stored preference.
    const [row] = await db.select().from(users).where(eq(users.email, 'locale@test.local'));
    expect(row.uiLocale).toBe('en');
  });
});
