/**
 * Integration coverage for the July 2026 scoped features, exercising the real
 * inbound pipeline against Postgres:
 *  - org-configured forced-escalation keywords: accent-insensitive match on
 *    the question path, escalation row + training event created WITHOUT
 *    blocking the grounded answer, forbidden-topic guard precedence, and
 *    non-matching questions left unaffected;
 *  - per-worker always-audio: a TEXT question gets a voice-note reply when
 *    the toggle is on, and stays text-only when it is off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, like } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import {
  escalations,
  messages,
  orgs,
  sopDocuments,
  trainingEvents,
  workers,
} from '../../src/server/db/schema.js';
import { saveBuffer } from '../../src/server/lib/storage.js';
import { processInbound } from '../../src/server/services/inbound.js';
import { ingestDocument } from '../../src/server/services/ingestion.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;

const SOP = `# Seguridad de químicos de prueba

## Ácido

1. El ácido se guarda en el gabinete rojo con la puerta cerrada.
2. Nunca mezcles el ácido con el cloro.
`;

let db: Db;
let org: typeof orgs.$inferSelect;
let nextPhone = 0;

function phone(): string {
  nextPhone += 1;
  return `+1500777${String(nextPhone).padStart(4, '0')}`;
}

async function makeWorker(
  overrides: Partial<typeof workers.$inferInsert> = {},
): Promise<typeof workers.$inferSelect> {
  const [w] = await db
    .insert(workers)
    .values({
      orgId: org.id,
      name: `Worker ${nextPhone + 1}`,
      phoneE164: phone(),
      consentStatus: 'opted_in',
      consentedAt: new Date(),
      consentMethod: 'whatsapp_keyword',
      // Pre-satisfied disclosure + open window so each test sees only the
      // messages its own question produces.
      disclosureSentAt: new Date(),
      lastInboundAt: new Date(),
      ...overrides,
    })
    .returning();
  return w;
}

async function ask(worker: typeof workers.$inferSelect, text: string): Promise<void> {
  await processInbound(db, { From: `whatsapp:${worker.phoneE164}`, Body: text });
}

async function keywordEscalations(workerId: string) {
  return db
    .select()
    .from(escalations)
    .where(
      and(eq(escalations.workerId, workerId), like(escalations.reason, 'Palabra clave%')),
    );
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS establo_test WITH (FORCE)');
  await admin.query('CREATE DATABASE establo_test');
  await admin.end();
  await runMigrations(TEST_URL);

  fs.rmSync(path.resolve('tests/.tmp-storage'), { recursive: true, force: true });
  resetRateLimits();
  db = getDb();

  // Keyword configured WITH the accent; workers type without it.
  [org] = await db
    .insert(orgs)
    .values({
      name: 'Test Dairy Keywords',
      timezone: 'America/Boise',
      escalationKeywords: ['ácido'],
    })
    .returning();

  const [doc] = await db
    .insert(sopDocuments)
    .values({ orgId: org.id, title: 'Seguridad de químicos de prueba', mimeType: 'text/markdown' })
    .returning();
  await saveBuffer(`${org.id}/sops/${doc.id}/sop.md`, Buffer.from(SOP));
  await db
    .update(sopDocuments)
    .set({ storagePath: `${org.id}/sops/${doc.id}/sop.md` })
    .where(eq(sopDocuments.id, doc.id));
  await ingestDocument(db, doc.id);
});

afterAll(async () => {
  await closeDb();
});

describe('forced-escalation keywords — inbound question path', () => {
  it('answers a keyword question normally AND creates the escalation + event', async () => {
    const worker = await makeWorker();
    await ask(worker, '¿donde guardo el acido?');

    // The grounded answer still went out (visibility, not a gag).
    const outbound = await db
      .select()
      .from(messages)
      .where(and(eq(messages.orgId, org.id), eq(messages.direction, 'outbound')));
    const answer = outbound.find((m) => m.bodyText?.includes('gabinete rojo'));
    expect(answer).toBeDefined();

    const [qa] = await db
      .select()
      .from(trainingEvents)
      .where(
        and(
          eq(trainingEvents.workerId, worker.id),
          eq(trainingEvents.eventType, 'qa_interaction'),
        ),
      );
    expect(qa.confidence).toBe('grounded');

    // Escalation row with the manager's spelling ("ácido"), matched against
    // the worker's accentless "acido".
    const escs = await keywordEscalations(worker.id);
    expect(escs).toHaveLength(1);
    expect(escs[0].reason).toBe('Palabra clave configurada por la granja: ácido');
    expect(escs[0].questionText).toBe('¿donde guardo el acido?');

    const escEvents = await db
      .select()
      .from(trainingEvents)
      .where(
        and(eq(trainingEvents.workerId, worker.id), eq(trainingEvents.eventType, 'escalation')),
      );
    expect(escEvents).toHaveLength(1);
    expect(escEvents[0].questionText).toBe('¿donde guardo el acido?');
  });

  it('leaves non-matching questions unaffected', async () => {
    const worker = await makeWorker();
    await ask(worker, '¿como cierro el gabinete rojo?');
    expect(await keywordEscalations(worker.id)).toHaveLength(0);
  });

  it('yields to the forbidden-topic guard — one escalation, the guard reason', async () => {
    const worker = await makeWorker();
    // Contains both the configured keyword AND a hard-guard dosing pattern.
    await ask(worker, '¿cuantos ml de acido le pongo a la vaca?');
    expect(await keywordEscalations(worker.id)).toHaveLength(0);
    const escs = await db
      .select()
      .from(escalations)
      .where(eq(escalations.workerId, worker.id));
    expect(escs).toHaveLength(1);
    expect(escs[0].reason).toContain('Tema restringido');
  });
});

describe('always-audio — inbound question path', () => {
  it('a text question gets a voice note when alwaysAudio is on, none when off', async () => {
    const before = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.orgId, org.id), eq(messages.type, 'voice')));

    const plain = await makeWorker({ alwaysAudio: false });
    await ask(plain, '¿donde se guarda el cloro?');
    const afterPlain = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.orgId, org.id), eq(messages.type, 'voice')));
    expect(afterPlain).toHaveLength(before.length);

    const listener = await makeWorker({ alwaysAudio: true });
    await ask(listener, '¿donde se guarda el cloro?');
    const afterListener = await db
      .select()
      .from(messages)
      .where(and(eq(messages.orgId, org.id), eq(messages.type, 'voice')));
    expect(afterListener).toHaveLength(before.length + 1);
    expect(afterListener[afterListener.length - 1].audioReplyUrl).toMatch(/^\/media\/audio\//);
  });
});
