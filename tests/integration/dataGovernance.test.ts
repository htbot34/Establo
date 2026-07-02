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
  auditExports,
  conversations,
  deletionLog,
  escalations,
  messages,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  trainingEvents,
  users,
  workers,
} from '../../src/server/db/schema.js';
import { auditCsvPath, runAuditExport } from '../../src/server/services/auditPack.js';
import { enrollWorker, runDripTick } from '../../src/server/services/drip.js';
import { generateWorkerTranscriptPdf } from '../../src/server/services/transcripts.js';
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

async function ownerSession(): Promise<Record<string, string>> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner-gov@test.local', password: 'password-gov' },
  });
  expect(login.statusCode).toBe(200);
  const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const csrf = login.cookies.find((c) => c.name === 'establo_csrf')?.value ?? '';
  return { cookie: cookieHeader, 'x-csrf-token': csrf };
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

describe('worker data deletion (BORRAR MIS DATOS)', () => {
  it('request → confirm → irreversible redaction, with training stubs surviving', async () => {
    const w = await makeWorker({
      name: 'Elena Prueba',
      consentStatus: 'opted_in',
      lastInboundAt: new Date(),
      disclosureSentAt: new Date(),
    });
    const phoneBefore = w.phoneE164;

    // A real interaction first, so there is content to redact (no SOPs in
    // this org → not_found → escalation row with the verbatim question).
    await injectInbound(w.phoneE164, '¿cuánto tiempo dejo el pre-dip?');

    await injectInbound(w.phoneE164, 'BORRAR MIS DATOS');
    const texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('SI BORRAR'))).toBe(true);
    const [pending] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(pending.deletionRequestedAt).not.toBeNull();
    expect(pending.deletedAt).toBeNull(); // nothing deleted without the confirm

    await injectInbound(w.phoneE164, 'SI BORRAR');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.name).toBe('Trabajador eliminado');
    expect(after.phoneE164).toMatch(/^deleted:/);
    expect(after.status).toBe('inactive');

    // Every message body/transcript is gone.
    const convRows = await db
      .select({ msg: messages })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.workerId, w.id));
    expect(convRows.length).toBeGreaterThan(0);
    for (const { msg } of convRows) {
      expect(msg.bodyText).toBeNull();
      expect(msg.transcriptText).toBeNull();
      expect(msg.mediaUrl).toBeNull();
      expect(msg.audioReplyUrl).toBeNull();
    }

    // Training events keep only the derived documentation fields.
    const events = await db
      .select()
      .from(trainingEvents)
      .where(eq(trainingEvents.workerId, w.id));
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect(ev.questionText).toBeNull();
      expect(ev.answerText).toBeNull();
      expect(ev.topic).toBeTruthy();
      expect(ev.occurredAt).toBeInstanceOf(Date);
    }

    // Escalation text carries the neutral marker, not the worker's words.
    const escRows = await db.select().from(escalations).where(eq(escalations.workerId, w.id));
    for (const esc of escRows) {
      expect(esc.questionText).toBe('Eliminado a petición del trabajador');
    }

    // The audit trail records only THAT it happened (org + timestamp).
    const logRows = await db.select().from(deletionLog).where(eq(deletionLog.orgId, orgA.id));
    expect(logRows.length).toBeGreaterThanOrEqual(1);

    // A later message from the old phone is now an unregistered number.
    const before = (await outboundTexts(w.id)).length;
    await injectInbound(phoneBefore, 'hola');
    expect((await outboundTexts(w.id)).length).toBe(before);
  });

  it('an unconfirmed request expires: SI BORRAR after the window re-prompts instead of deleting', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    await injectInbound(w.phoneE164, 'borrar mis datos');
    await db
      .update(workers)
      .set({ deletionRequestedAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(workers.id, w.id));

    await injectInbound(w.phoneE164, 'SI BORRAR');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.deletedAt).toBeNull();
    expect(after.name).not.toBe('Trabajador eliminado');
    // …and the flow re-armed with a fresh prompt.
    const texts = await outboundTexts(w.id);
    expect(texts.filter((t) => t.includes('SI BORRAR')).length).toBeGreaterThanOrEqual(2);
  });

  it('tombstone phones never collide: two deletions in one org satisfy the unique index', async () => {
    const w1 = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    const w2 = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    for (const w of [w1, w2]) {
      await injectInbound(w.phoneE164, 'BORRAR MIS DATOS');
      await injectInbound(w.phoneE164, 'SI BORRAR');
    }
    const rows = await db.select().from(workers).where(eq(workers.name, 'Trabajador eliminado'));
    const tombstones = rows.map((r) => r.phoneE164);
    expect(new Set(tombstones).size).toBe(tombstones.length);
  });

  it('a deleted worker is excluded from drip sends', async () => {
    const [track] = await db
      .insert(onboardingTracks)
      .values({ orgId: orgA.id, name: 'Track de gobernanza' })
      .returning();
    await db.insert(modules).values({
      trackId: track.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
      title: 'Lección', bodyEs: 'Cuerpo.', checkQuestionEs: '¿Listo?',
      checkOptionsEs: ['Sí', 'No', 'Tal vez'], checkCorrectIndex: 0,
    });
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    const { enrollmentId } = await enrollWorker(db, { workerId: w.id, trackId: track.id });
    await db
      .update(moduleDeliveries)
      .set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));

    await injectInbound(w.phoneE164, 'BORRAR MIS DATOS');
    await injectInbound(w.phoneE164, 'SI BORRAR');

    await runDripTick(db);
    const [delivery] = await db
      .select()
      .from(moduleDeliveries)
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
    expect(delivery.status).toBe('pending'); // never sent
  });

  it('the manager dashboard action runs the same redaction; deleted records are immutable', async () => {
    const w = await makeWorker({ name: 'Borrado Por Manager', notes: 'nota sensible' });
    const headers = await ownerSession();

    const del = await app.inject({
      method: 'POST',
      url: `/api/workers/${w.id}/delete-data`,
      headers,
      payload: {},
    });
    expect(del.statusCode).toBe(200);
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.name).toBe('Trabajador eliminado');
    expect(after.notes).toBeNull();

    // Second delete → 409; edits → 404; transcript → 410.
    const again = await app.inject({
      method: 'POST',
      url: `/api/workers/${w.id}/delete-data`,
      headers,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/workers/${w.id}`,
      headers,
      payload: { name: 'Renombrado' },
    });
    expect(patch.statusCode).toBe(404);
    const pdf = await app.inject({
      method: 'GET',
      url: `/api/workers/${w.id}/transcript.pdf`,
      headers,
    });
    expect(pdf.statusCode).toBe(410);

    // The overview shows a non-identifying notice.
    const overview = await app.inject({ method: 'GET', url: '/api/overview', headers });
    const body = JSON.parse(overview.body) as {
      dataDeletions: Array<{ id: string; deletedAt: string }>;
    };
    expect(body.dataDeletions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body.dataDeletions)).not.toContain('Borrado Por Manager');
  });
});

describe('export minimization', () => {
  it('CSV has no phone/confidence columns; deleted workers are absent from every artifact', async () => {
    const live = await makeWorker({
      name: 'Viva Exportada',
      consentStatus: 'opted_in',
      lastInboundAt: new Date(),
      disclosureSentAt: new Date(),
    });
    const gone = await makeWorker({
      name: 'Se Borro Antes',
      consentStatus: 'opted_in',
      lastInboundAt: new Date(),
      disclosureSentAt: new Date(),
    });
    await db.insert(trainingEvents).values([
      {
        orgId: orgA.id, workerId: live.id, eventType: 'qa_interaction', topic: 'Ordeño',
        farmTopic: 'none', questionText: 'pregunta exportada', answerText: 'respuesta',
        confidence: 'grounded',
      },
      {
        orgId: orgA.id, workerId: gone.id, eventType: 'qa_interaction', topic: 'Ordeño',
        farmTopic: 'none', questionText: 'pregunta del borrado', answerText: 'respuesta',
        confidence: 'grounded',
      },
    ]);
    await injectInbound(gone.phoneE164, 'BORRAR MIS DATOS');
    await injectInbound(gone.phoneE164, 'SI BORRAR');

    const [job] = await db
      .insert(auditExports)
      .values({
        orgId: orgA.id,
        periodStart: new Date(Date.now() - 30 * 86_400_000),
        periodEnd: new Date(Date.now() + 86_400_000),
        status: 'pending',
      })
      .returning();
    await runAuditExport(db, job.id);
    const [done] = await db.select().from(auditExports).where(eq(auditExports.id, job.id));
    expect(done.status).toBe('ready');

    const csv = await fs.promises.readFile(absPath(auditCsvPath(orgA.id, job.id)), 'utf8');
    const header = csv.split('\r\n')[0];
    expect(header).not.toContain('phone');
    expect(header).not.toContain('confidence');
    expect(header).not.toContain('source_chunk'); // internal signal, never exported
    expect(header).toContain('employee');
    expect(csv).toContain('Viva Exportada');
    expect(csv).not.toContain(live.phoneE164);
    expect(csv).not.toContain('Se Borro Antes');
    expect(csv).not.toContain('Trabajador eliminado');
    expect(csv).not.toContain('pregunta del borrado');

    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const letter = await pdfParse(
      await fs.promises.readFile(absPath(`${orgA.id}/audit/${job.id}/training-letter.pdf`)),
    );
    expect(letter.text).toContain('Viva Exportada');
    expect(letter.text).not.toContain('Trabajador eliminado');
  });

  it('per-worker transcript PDFs carry the source but never the confidence signal', async () => {
    const w = await makeWorker({ name: 'Ana Transcrita', consentStatus: 'opted_in' });
    await db.insert(trainingEvents).values({
      orgId: orgA.id, workerId: w.id, eventType: 'qa_interaction', topic: 'Ordeño',
      farmTopic: 'none', questionText: '¿cuánto pre-dip?', answerText: '30 segundos',
      confidence: 'grounded',
    });
    const buffer = await generateWorkerTranscriptPdf(db, w.id);
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(buffer);
    expect(parsed.text).toContain('Ana Transcrita');
    expect(parsed.text).not.toContain('Grounding');
  });
});
