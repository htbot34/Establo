/**
 * Data-governance integration tests: raw-content retention (nightly prune),
 * worker data deletion (BORRAR MIS DATOS), and export minimization. These
 * are the mechanisms DATA-POLICY.md promises — every claim there should have
 * a test here.
 */
import fs from 'node:fs';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import {
  conversations,
  messages,
  orgs,
  trainingEvents,
  users,
  workers,
} from '../../src/server/db/schema.js';
import { resetInboundCachesForTests } from '../../src/server/services/inbound.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';
import { pruneRawContent } from '../../src/server/services/retention.js';
import { synthesizeSpeech } from '../../src/server/services/speech.js';
import { absPath } from '../../src/server/lib/storage.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;

let app: FastifyInstance;
let db: Db;
let orgA: typeof orgs.$inferSelect;
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
    .values({ orgId: orgA.id, name: `Worker ${nextPhone + 1}`, phoneE164: phone(), ...overrides })
    .returning();
  return w;
}

async function makeConversation(workerId: string): Promise<string> {
  const [conv] = await db
    .insert(conversations)
    .values({ workerId, orgId: orgA.id })
    .returning();
  return conv.id;
}

async function injectInbound(from: string, body: string): Promise<number> {
  const payload = new URLSearchParams({
    From: `whatsapp:${from}`,
    Body: body,
    NumMedia: '0',
    MessageSid: `SMD${Date.now()}${Math.floor(Math.random() * 1000)}`,
  }).toString();
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/twilio',
    payload,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return res.statusCode;
}

async function outboundTexts(workerId: string): Promise<string[]> {
  const rows = await db
    .select({ body: messages.bodyText })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.workerId, workerId))
    .orderBy(messages.createdAt);
  return rows.map((r) => r.body ?? '');
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS establo_test WITH (FORCE)');
  await admin.query('CREATE DATABASE establo_test');
  await admin.end();
  await runMigrations(TEST_URL);

  resetRateLimits();
  resetInboundCachesForTests();
  db = getDb();

  [orgA] = await db.insert(orgs).values({ name: 'Governance Dairy' }).returning();
  await db.insert(users).values({
    orgId: orgA.id,
    email: 'owner-gov@test.local',
    passwordHash: await argon2.hash('password-gov'),
    role: 'owner',
    name: 'Owner Gov',
  });

  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closeDb();
});

describe('raw-content retention prune (RAW_CONTENT_RETENTION_DAYS)', () => {
  it('redacts content and deletes audio past the cutoff; keeps newer rows and derived fields', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date() });
    const convId = await makeConversation(w.id);
    const old = new Date(Date.now() - 200 * 24 * 3600_000); // past the 180-day default
    const recent = new Date(Date.now() - 5 * 24 * 3600_000);

    const audio = await synthesizeSpeech('respuesta vieja');
    expect(fs.existsSync(absPath(audio.relPath))).toBe(true);

    const [oldMsg] = await db
      .insert(messages)
      .values({
        conversationId: convId,
        orgId: orgA.id,
        direction: 'inbound',
        type: 'voice',
        bodyText: null,
        transcriptText: 'cuanto tiempo dejo el pre-dip',
        mediaUrl: 'https://api.twilio.com/media/ME123',
        audioReplyUrl: audio.publicUrl,
        createdAt: old,
      })
      .returning();
    const [newMsg] = await db
      .insert(messages)
      .values({
        conversationId: convId,
        orgId: orgA.id,
        direction: 'inbound',
        type: 'text',
        bodyText: 'pregunta reciente',
        createdAt: recent,
      })
      .returning();

    const [oldEvent] = await db
      .insert(trainingEvents)
      .values({
        orgId: orgA.id,
        workerId: w.id,
        eventType: 'qa_interaction',
        topic: 'Ordeño',
        farmTopic: 'stockmanship_general',
        questionText: 'pregunta vieja',
        answerText: 'respuesta vieja',
        sourceChunkIds: ['chunk-1'],
        confidence: 'grounded',
        occurredAt: old,
      })
      .returning();
    const [newEvent] = await db
      .insert(trainingEvents)
      .values({
        orgId: orgA.id,
        workerId: w.id,
        eventType: 'qa_interaction',
        topic: 'Ordeño',
        farmTopic: 'none',
        questionText: 'pregunta reciente',
        answerText: 'respuesta reciente',
        occurredAt: recent,
      })
      .returning();

    const result = await pruneRawContent(db);
    expect(result.messagesRedacted).toBeGreaterThanOrEqual(1);
    expect(result.eventsRedacted).toBeGreaterThanOrEqual(1);
    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);

    const [prunedMsg] = await db.select().from(messages).where(eq(messages.id, oldMsg.id));
    expect(prunedMsg.bodyText).toBeNull();
    expect(prunedMsg.transcriptText).toBeNull();
    expect(prunedMsg.mediaUrl).toBeNull();
    expect(prunedMsg.audioReplyUrl).toBeNull();
    expect(fs.existsSync(absPath(audio.relPath))).toBe(false);
    // Message metadata survives — the interaction still counts.
    expect(prunedMsg.direction).toBe('inbound');
    expect(prunedMsg.type).toBe('voice');

    const [keptMsg] = await db.select().from(messages).where(eq(messages.id, newMsg.id));
    expect(keptMsg.bodyText).toBe('pregunta reciente');

    const [prunedEvent] = await db
      .select()
      .from(trainingEvents)
      .where(eq(trainingEvents.id, oldEvent.id));
    expect(prunedEvent.questionText).toBeNull();
    expect(prunedEvent.answerText).toBeNull();
    // The derived training-documentation fields are untouched.
    expect(prunedEvent.topic).toBe('Ordeño');
    expect(prunedEvent.farmTopic).toBe('stockmanship_general');
    expect(prunedEvent.confidence).toBe('grounded');
    expect(prunedEvent.sourceChunkIds).toEqual(['chunk-1']);
    expect(prunedEvent.eventType).toBe('qa_interaction');
    expect(prunedEvent.occurredAt.getTime()).toBe(old.getTime());

    const [keptEvent] = await db
      .select()
      .from(trainingEvents)
      .where(eq(trainingEvents.id, newEvent.id));
    expect(keptEvent.questionText).toBe('pregunta reciente');

    // Idempotent: a second run matches nothing.
    const again = await pruneRawContent(db);
    expect(again.messagesRedacted).toBe(0);
    expect(again.eventsRedacted).toBe(0);
  });
});
