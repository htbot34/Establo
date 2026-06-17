import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { and, desc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import {
  enrollments,
  messages,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  sopDocuments,
  trainingEvents,
  users,
  workers,
} from '../../src/server/db/schema.js';
import { saveBuffer } from '../../src/server/lib/storage.js';
import { certificateRelPath } from '../../src/server/services/certificates.js';
import { enrollWorker, runDripTick } from '../../src/server/services/drip.js';
import { ingestDocument } from '../../src/server/services/ingestion.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';
import { retrieveChunks } from '../../src/server/services/retrieval.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;

const PHONE_A = '+15005550001';
const PHONE_B = '+15005550002';

const SOP_A = `# Rutina de ordeño de prueba

## Pre-dip

1. Aplica el pre-dip cubriendo 3/4 del pezón.
2. Deja el pre-dip actuar 30 segundos antes de secar.
3. Seca con una toalla individual, una toalla por vaca.
`;

const SOP_B = `# Becerras de prueba

## Calostro

1. Da 4 litros de calostro en las primeras 2 horas de vida.
2. Desinfecta el ombligo con yodo al 7%.
`;

let app: FastifyInstance;
let db: Db;
let orgA: typeof orgs.$inferSelect;
let orgB: typeof orgs.$inferSelect;
let workerA: typeof workers.$inferSelect;
let workerB: typeof workers.$inferSelect;
let docA: typeof sopDocuments.$inferSelect;
let docB: typeof sopDocuments.$inferSelect;
let trackA: typeof onboardingTracks.$inferSelect;

async function injectInbound(
  params: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  const body = new URLSearchParams(params).toString();
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/twilio',
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return { statusCode: res.statusCode, body: res.body };
}

beforeAll(async () => {
  // Fresh test database.
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS establo_test WITH (FORCE)');
  await admin.query('CREATE DATABASE establo_test');
  await admin.end();
  await runMigrations(TEST_URL);

  fs.rmSync(path.resolve('tests/.tmp-storage'), { recursive: true, force: true });
  resetRateLimits();
  db = getDb();

  // Two tenants.
  [orgA] = await db.insert(orgs).values({ name: 'Test Dairy A', timezone: 'America/Boise' }).returning();
  [orgB] = await db.insert(orgs).values({ name: 'Test Dairy B', timezone: 'America/Boise' }).returning();
  await db.insert(users).values([
    { orgId: orgA.id, email: 'a@test.local', passwordHash: await argon2.hash('password-aaa'), role: 'owner', name: 'Owner A' },
    { orgId: orgB.id, email: 'b@test.local', passwordHash: await argon2.hash('password-bbb'), role: 'owner', name: 'Owner B' },
  ]);
  [workerA] = await db
    .insert(workers)
    .values({ orgId: orgA.id, name: 'Trabajador Uno', phoneE164: PHONE_A, lastInboundAt: new Date() })
    .returning();
  [workerB] = await db
    .insert(workers)
    .values({ orgId: orgB.id, name: 'Trabajadora Dos', phoneE164: PHONE_B, lastInboundAt: new Date() })
    .returning();

  // One SOP per tenant, ingested with stub embeddings.
  [docA] = await db
    .insert(sopDocuments)
    .values({ orgId: orgA.id, title: 'Rutina de ordeño de prueba', mimeType: 'text/markdown' })
    .returning();
  await saveBuffer(`${orgA.id}/sops/${docA.id}/sop.md`, Buffer.from(SOP_A));
  await db.update(sopDocuments).set({ storagePath: `${orgA.id}/sops/${docA.id}/sop.md` }).where(eq(sopDocuments.id, docA.id));
  await ingestDocument(db, docA.id);

  [docB] = await db
    .insert(sopDocuments)
    .values({ orgId: orgB.id, title: 'Becerras de prueba', mimeType: 'text/markdown' })
    .returning();
  await saveBuffer(`${orgB.id}/sops/${docB.id}/sop.md`, Buffer.from(SOP_B));
  await db.update(sopDocuments).set({ storagePath: `${orgB.id}/sops/${docB.id}/sop.md` }).where(eq(sopDocuments.id, docB.id));
  await ingestDocument(db, docB.id);

  // Track with two modules for org A (module 2 due tomorrow).
  [trackA] = await db
    .insert(onboardingTracks)
    .values({ orgId: orgA.id, name: 'Inducción de prueba' })
    .returning();
  await db.insert(modules).values([
    {
      trackId: trackA.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
      title: 'El pre-dip', bodyEs: 'El pre-dip se deja 30 segundos en el pezón.',
      checkQuestionEs: '¿Cuánto tiempo se deja el pre-dip?',
      checkOptionsEs: ['5 segundos', '30 segundos', '5 minutos'], checkCorrectIndex: 1,
      sourceDocumentId: docA.id,
    },
    {
      trackId: trackA.id, orgId: orgA.id, orderIndex: 1, dayOffset: 1, sendHourLocal: 7,
      title: 'Las toallas', bodyEs: 'Cada vaca se seca con su propia toalla.',
      checkQuestionEs: '¿Cómo se usan las toallas?',
      checkOptionsEs: ['Una para todas', 'Una por vaca', 'No se usan'], checkCorrectIndex: 1,
      sourceDocumentId: docA.id,
    },
  ]);

  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closeDb();
});

describe('webhook → answer pipeline (mock mode, inline jobs)', () => {
  it('answers an SOP question with a grounded reply, citation, and training event', async () => {
    const res = await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: '¿cuánto tiempo dejo el pre-dip?',
      NumMedia: '0',
      MessageSid: 'SMIT001',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Response>');

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgA.id))
      .orderBy(desc(messages.createdAt))
      .limit(5);
    const outbound = rows.find((m) => m.direction === 'outbound' && m.type === 'text');
    expect(outbound?.bodyText).toContain('30 segundos');
    expect(outbound?.bodyText).toContain('📄 Fuente: Rutina de ordeño de prueba');

    const [event] = await db
      .select()
      .from(trainingEvents)
      .where(and(eq(trainingEvents.workerId, workerA.id), eq(trainingEvents.eventType, 'qa_interaction')))
      .orderBy(desc(trainingEvents.occurredAt))
      .limit(1);
    expect(event.confidence).toBe('grounded');
    expect(event.sourceDocumentId).toBe(docA.id);
    expect(event.questionText).toContain('pre-dip');
  });

  it('handles voice notes: transcript in, audio reply out', async () => {
    await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: '',
      NumMedia: '1',
      MediaContentType0: 'audio/ogg',
      MediaUrl0: 'mock://voice',
      MockTranscript: '¿cuántas toallas uso por vaca?',
      MessageSid: 'SMIT002',
    });
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgA.id))
      .orderBy(desc(messages.createdAt))
      .limit(4);
    const inboundVoice = rows.find((m) => m.direction === 'inbound' && m.type === 'voice');
    expect(inboundVoice?.transcriptText).toContain('toallas');
    const outboundVoice = rows.find((m) => m.direction === 'outbound' && m.type === 'voice');
    expect(outboundVoice?.audioReplyUrl).toMatch(/^\/media\/audio\/.+\.(ogg|mp3)$/);
  });

  it('replies once to unknown numbers and stores nothing', async () => {
    const before = await db.select().from(messages);
    const res = await injectInbound({
      From: 'whatsapp:+19998887777',
      Body: 'hola',
      NumMedia: '0',
      MessageSid: 'SMIT003',
    });
    expect(res.statusCode).toBe(200);
    const after = await db.select().from(messages);
    expect(after.length).toBe(before.length);
  });

  it('escalates out-of-scope topics (salary) with a polite refusal', async () => {
    await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: '¿me puedes subir el sueldo?',
      NumMedia: '0',
      MessageSid: 'SMIT004',
    });
    const [event] = await db
      .select()
      .from(trainingEvents)
      .where(and(eq(trainingEvents.workerId, workerA.id), eq(trainingEvents.eventType, 'escalation')))
      .orderBy(desc(trainingEvents.occurredAt))
      .limit(1);
    expect(event).toBeDefined();
    expect(event.confidence).toBe('not_found');
  });
});

describe('multi-tenant isolation', () => {
  it('retrieval never crosses org boundaries', async () => {
    const chunksForB = await retrieveChunks(db, orgB.id, 'pre-dip pezón toalla ordeño', 6);
    expect(chunksForB.length).toBeGreaterThan(0);
    for (const c of chunksForB) {
      expect(c.documentId).toBe(docB.id); // only org B's own document
    }
    const chunksForA = await retrieveChunks(db, orgA.id, 'calostro becerra ombligo', 6);
    for (const c of chunksForA) {
      expect(c.documentId).toBe(docA.id);
    }
  });

  it("org B's dashboard session cannot read org A's resources", async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'b@test.local', password: 'password-bbb' },
    });
    expect(login.statusCode).toBe(200);
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const workerRes = await app.inject({
      method: 'GET',
      url: `/api/workers/${workerA.id}`,
      headers: { cookie: cookieHeader },
    });
    expect(workerRes.statusCode).toBe(404);

    const sopRes = await app.inject({
      method: 'GET',
      url: `/api/sops/${docA.id}`,
      headers: { cookie: cookieHeader },
    });
    expect(sopRes.statusCode).toBe(404);

    const fileRes = await app.inject({
      method: 'GET',
      url: `/api/files/${orgA.id}/sops/${docA.id}/sop.md`,
      headers: { cookie: cookieHeader },
    });
    expect(fileRes.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: '/api/workers',
      headers: { cookie: cookieHeader },
    });
    const names = (JSON.parse(list.body) as Array<{ id: string }>).map((w) => w.id);
    expect(names).toContain(workerB.id);
    expect(names).not.toContain(workerA.id);
  });
});

describe('drip engine: 24h window, template handshake, checks, certificate', () => {
  let enrollmentId: string;

  it('enrolling schedules one delivery per module', async () => {
    const result = await enrollWorker(db, { workerId: workerA.id, trackId: trackA.id });
    enrollmentId = result.enrollmentId;
    const deliveries = await db
      .select()
      .from(moduleDeliveries)
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'pending')).toBe(true);
  });

  it('outside the 24h window the scheduler sends the notify template, not the lesson', async () => {
    await db
      .update(workers)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3600_000) })
      .where(eq(workers.id, workerA.id));

    const tick = await runDripTick(db);
    expect(tick.notified).toBe(1);
    expect(tick.delivered).toBe(0);

    const [delivery] = await db
      .select()
      .from(moduleDeliveries)
      .where(and(eq(moduleDeliveries.enrollmentId, enrollmentId), eq(moduleDeliveries.status, 'notified')));
    expect(delivery).toBeDefined();

    const [template] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.orgId, orgA.id), eq(messages.type, 'template')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    expect(template.bodyText).toContain('Responde OK para recibirla');
    expect(template.bodyText).toContain('El pre-dip');
  });

  it('replying OK opens the window and delivers the full module', async () => {
    await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: 'OK',
      NumMedia: '0',
      MessageSid: 'SMIT005',
    });
    const [delivery] = await db
      .select()
      .from(moduleDeliveries)
      .where(and(eq(moduleDeliveries.enrollmentId, enrollmentId), eq(moduleDeliveries.status, 'sent')));
    expect(delivery).toBeDefined();

    const recent = await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgA.id))
      .orderBy(desc(messages.createdAt))
      .limit(4);
    const lesson = recent.find((m) => m.bodyText?.includes('Lección 1 de 2'));
    expect(lesson?.bodyText).toContain('Pregunta rápida');
    expect(lesson?.bodyText).toContain('1) 5 segundos');
  });

  it('grades a correct check answer ("2") and logs check_passed', async () => {
    await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: '2',
      NumMedia: '0',
      MessageSid: 'SMIT006',
    });
    const [delivery] = await db
      .select()
      .from(moduleDeliveries)
      .where(and(eq(moduleDeliveries.enrollmentId, enrollmentId), eq(moduleDeliveries.status, 'answered')));
    expect(delivery.checkAnswerIndex).toBe(1);
    expect(delivery.checkPassed).toBe(true);

    const [event] = await db
      .select()
      .from(trainingEvents)
      .where(and(eq(trainingEvents.workerId, workerA.id), eq(trainingEvents.eventType, 'check_passed')))
      .orderBy(desc(trainingEvents.occurredAt))
      .limit(1);
    expect(event).toBeDefined();
  });

  it('grades a wrong answer on the final module, completes the track, and generates the certificate', async () => {
    // Make module 2 due now; window is open (worker just wrote).
    await db
      .update(moduleDeliveries)
      .set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(and(eq(moduleDeliveries.enrollmentId, enrollmentId), eq(moduleDeliveries.status, 'pending')));
    const tick = await runDripTick(db);
    expect(tick.delivered).toBe(1);

    await injectInbound({
      From: `whatsapp:${PHONE_A}`,
      Body: '1', // wrong — correct is 2
      NumMedia: '0',
      MessageSid: 'SMIT007',
    });

    const failed = await db
      .select()
      .from(trainingEvents)
      .where(and(eq(trainingEvents.workerId, workerA.id), eq(trainingEvents.eventType, 'check_failed')));
    expect(failed.length).toBe(1);

    const [enr] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
    expect(enr.status).toBe('completed');

    const certAbs = path.resolve('tests/.tmp-storage', certificateRelPath(orgA.id, enrollmentId));
    expect(fs.existsSync(certAbs)).toBe(true);
    expect(fs.statSync(certAbs).size).toBeGreaterThan(1000);

    const recent = await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgA.id))
      .orderBy(desc(messages.createdAt))
      .limit(3);
    expect(recent.some((m) => m.bodyText?.includes('Felicidades'))).toBe(true);
    // Incorrect-answer feedback includes the right answer, no re-quiz.
    expect(recent.some((m) => m.bodyText?.includes('La respuesta correcta es: 2) Una por vaca'))).toBe(true);
  });
});

describe('role-scoped onboarding', () => {
  it('delivers universal + role-specific modules; two roles get different sets', async () => {
    // A track with one universal module and one per role.
    const [track] = await db
      .insert(onboardingTracks)
      .values({ orgId: orgA.id, name: 'Inducción por rol' })
      .returning();
    await db.insert(modules).values([
      {
        trackId: track.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
        title: 'Seguridad de químicos (universal)', bodyEs: 'Nunca mezcles cloro con ácido.',
        checkQuestionEs: '¿Mezclar cloro con ácido?', checkOptionsEs: ['Sí', 'No', 'A veces'],
        checkCorrectIndex: 1, appliesToRoles: [],
      },
      {
        trackId: track.id, orgId: orgA.id, orderIndex: 1, dayOffset: 1, sendHourLocal: 7,
        title: 'Rutina de ordeño', bodyEs: 'El pre-dip se deja 30 segundos.',
        checkQuestionEs: '¿Cuánto dura el pre-dip?', checkOptionsEs: ['5 s', '30 s', '5 min'],
        checkCorrectIndex: 1, appliesToRoles: ['ordeno'],
      },
      {
        trackId: track.id, orgId: orgA.id, orderIndex: 2, dayOffset: 2, sendHourLocal: 7,
        title: 'Calostro de la becerra', bodyEs: '4 litros en las primeras 2 horas.',
        checkQuestionEs: '¿Cuánto calostro?', checkOptionsEs: ['1 L', '4 L', 'Nada'],
        checkCorrectIndex: 1, appliesToRoles: ['becerras'],
      },
    ]);

    const [milker] = await db
      .insert(workers)
      .values({ orgId: orgA.id, name: 'Ordeñador', phoneE164: '+15005550010', jobRole: 'ordeno' })
      .returning();
    const [calfHand] = await db
      .insert(workers)
      .values({ orgId: orgA.id, name: 'Becerrero', phoneE164: '+15005550011', jobRole: 'becerras' })
      .returning();

    const milkerEnr = await enrollWorker(db, { workerId: milker.id, trackId: track.id });
    const calfEnr = await enrollWorker(db, { workerId: calfHand.id, trackId: track.id });

    const titlesFor = async (enrollmentId: string): Promise<string[]> => {
      const rows = await db
        .select({ title: modules.title })
        .from(moduleDeliveries)
        .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
        .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
      return rows.map((r) => r.title);
    };
    const milkerTitles = await titlesFor(milkerEnr.enrollmentId);
    const calfTitles = await titlesFor(calfEnr.enrollmentId);

    expect(milkerTitles.sort()).toEqual(['Rutina de ordeño', 'Seguridad de químicos (universal)']);
    expect(calfTitles.sort()).toEqual(['Calostro de la becerra', 'Seguridad de químicos (universal)']);
  });

  it('a worker whose role matches no module (and no universal exists) cannot enroll', async () => {
    const [track] = await db
      .insert(onboardingTracks)
      .values({ orgId: orgA.id, name: 'Solo ordeño' })
      .returning();
    await db.insert(modules).values({
      trackId: track.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
      title: 'Solo para ordeñadores', bodyEs: 'Rutina de ordeño.',
      checkQuestionEs: '¿Listo?', checkOptionsEs: ['Sí', 'No', 'Tal vez'],
      checkCorrectIndex: 0, appliesToRoles: ['ordeno'],
    });
    const [feeder] = await db
      .insert(workers)
      .values({ orgId: orgA.id, name: 'Alimentador', phoneE164: '+15005550012', jobRole: 'alimentacion' })
      .returning();
    await expect(enrollWorker(db, { workerId: feeder.id, trackId: track.id })).rejects.toThrow(/role/);
  });
});

describe('optional per-module video', () => {
  it('delivers a module with a video as a link line (never an upload)', async () => {
    const [track] = await db
      .insert(onboardingTracks)
      .values({ orgId: orgA.id, name: 'Track con video' })
      .returning();
    await db.insert(modules).values({
      trackId: track.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
      title: 'Lección con video', bodyEs: 'Mira el video y luego responde.',
      checkQuestionEs: '¿Listo?', checkOptionsEs: ['Sí', 'No', 'Tal vez'], checkCorrectIndex: 0,
      videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      videoTitleEs: 'Manejo de ganado', videoProvider: 'youtube', videoLangs: ['es'],
    });
    const [w] = await db
      .insert(workers)
      .values({
        orgId: orgA.id, name: 'Video Worker', phoneE164: '+15005550020',
        lastInboundAt: new Date(), consentStatus: 'opted_in',
      })
      .returning();
    await enrollWorker(db, { workerId: w.id, trackId: track.id });
    const tick = await runDripTick(db); // window open → delivered immediately
    expect(tick.delivered).toBeGreaterThanOrEqual(1);

    const recent = await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgA.id))
      .orderBy(desc(messages.createdAt))
      .limit(6);
    const lesson = recent.find((m) => m.bodyText?.includes('Lección con video'));
    expect(lesson?.bodyText).toContain(
      '📹 Mira el video (Manejo de ganado): https://www.youtube.com/watch?v=jNQXAC9IVRw',
    );
    // It is a link in the text, not a media upload.
    expect(lesson?.mediaUrl ?? null).toBeNull();
  });
});
