/**
 * Compliance hardening integration tests: worker opt-in/opt-out gates,
 * first-contact disclosure, cow care agreement (ACEPTO) signatures,
 * supervisor sign-off, the FARM Animal Care v5 audit pack, template-failure
 * pausing, cross-tenant isolation of the new tables, and the
 * POLICY-SCOPE.md open-domain refusal.
 */
import argon2 from 'argon2';
import { and, desc, eq, like } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { closeDb, getDb, type Db } from '../../src/server/db/client.js';
import { runMigrations } from '../../src/server/db/migrate.js';
import { resetConfigForTests } from '../../src/server/config.js';
import {
  agreementSignatures,
  auditExports,
  conversations,
  enrollments,
  escalations,
  messages,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  sopDocuments,
  users,
  workers,
} from '../../src/server/db/schema.js';
import { absPath, saveBuffer } from '../../src/server/lib/storage.js';
import {
  getOrCreateActiveAgreement,
  requestAgreementSignature,
} from '../../src/server/services/agreements.js';
import { answerQuestion } from '../../src/server/services/answer.js';
import { runAuditExport, auditCsvPath } from '../../src/server/services/auditPack.js';
import { enrollWorker, runDripTick } from '../../src/server/services/drip.js';
import { resetInboundCachesForTests } from '../../src/server/services/inbound.js';
import { ingestDocument } from '../../src/server/services/ingestion.js';
import { resetRateLimits } from '../../src/server/services/rateLimit.js';
import { sendToWorker } from '../../src/server/services/sendToWorker.js';
import { logTrainingEvent } from '../../src/server/services/trainingEvents.js';

const ADMIN_URL = 'postgres://establo:establo@localhost:5432/establo';
const TEST_URL = process.env.DATABASE_URL!;

const SOP_A = `# Rutina de ordeño de prueba

## Pre-dip

1. Aplica el pre-dip cubriendo 3/4 del pezón.
2. Deja el pre-dip actuar 30 segundos antes de secar.

## Vacas caídas

1. Si una vaca se cae y no se para, dale espacio y avisa al encargado.
`;

let app: FastifyInstance;
let db: Db;
let orgA: typeof orgs.$inferSelect;
let orgB: typeof orgs.$inferSelect;
let trackA: typeof onboardingTracks.$inferSelect;
let docA: typeof sopDocuments.$inferSelect;
let nextPhone = 0;

function phone(): string {
  nextPhone += 1;
  return `+1500666${String(nextPhone).padStart(4, '0')}`;
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

async function injectInbound(from: string, body: string): Promise<number> {
  const payload = new URLSearchParams({
    From: `whatsapp:${from}`,
    Body: body,
    NumMedia: '0',
    MessageSid: `SMC${Date.now()}${Math.floor(Math.random() * 1000)}`,
  }).toString();
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/twilio',
    payload,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return res.statusCode;
}

/** All outbound message bodies for a worker, oldest first. */
async function outboundTexts(workerId: string): Promise<string[]> {
  const rows = await db
    .select({ body: messages.bodyText })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.workerId, workerId), eq(messages.direction, 'outbound')))
    .orderBy(messages.createdAt);
  return rows.map((r) => r.body ?? '');
}

async function ownerSession(email: string, password: string): Promise<Record<string, string>> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
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

  [orgA] = await db.insert(orgs).values({ name: 'Compliance Dairy A' }).returning();
  [orgB] = await db.insert(orgs).values({ name: 'Compliance Dairy B' }).returning();
  await db.insert(users).values([
    { orgId: orgA.id, email: 'owner-a@test.local', passwordHash: await argon2.hash('password-aaa'), role: 'owner', name: 'Owner A' },
    { orgId: orgB.id, email: 'owner-b@test.local', passwordHash: await argon2.hash('password-bbb'), role: 'owner', name: 'Owner B' },
  ]);

  [docA] = await db
    .insert(sopDocuments)
    .values({ orgId: orgA.id, title: 'Rutina de ordeño de prueba', mimeType: 'text/markdown' })
    .returning();
  await saveBuffer(`${orgA.id}/sops/${docA.id}/sop.md`, Buffer.from(SOP_A));
  await db
    .update(sopDocuments)
    .set({ storagePath: `${orgA.id}/sops/${docA.id}/sop.md` })
    .where(eq(sopDocuments.id, docA.id));
  await ingestDocument(db, docA.id);

  [trackA] = await db
    .insert(onboardingTracks)
    .values({ orgId: orgA.id, name: 'Inducción de cumplimiento' })
    .returning();
  await db.insert(modules).values({
    trackId: trackA.id, orgId: orgA.id, orderIndex: 0, dayOffset: 0, sendHourLocal: 7,
    farmTopic: 'stockmanship_general',
    title: 'Vacas caídas', bodyEs: 'Si una vaca se cae, dale espacio y avisa al encargado.',
    checkQuestionEs: '¿Qué haces si una vaca se cae?',
    checkOptionsEs: ['La jalo', 'Le doy espacio y aviso', 'Nada'], checkCorrectIndex: 1,
    sourceDocumentId: docA.id,
  });

  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closeDb();
});

describe('sendToWorker opt-in hard gate', () => {
  it('refuses business-initiated sends (free-form and template) to pending workers', async () => {
    const w = await makeWorker({ lastInboundAt: new Date() }); // window open, but never opted in
    const freeform = await sendToWorker(db, w.id, { text: 'lección', kind: 'business' });
    expect(freeform).toEqual({ ok: false, reason: 'not_opted_in', messageIds: [] });

    const dflt = await sendToWorker(db, w.id, { text: 'lección sin kind' }); // default = business
    expect(dflt.ok).toBe(false);

    const template = await sendToWorker(db, w.id, {
      text: '',
      template: { name: 'establo_module_notify', vars: ['X', 'Y'] },
    });
    expect(template).toEqual({ ok: false, reason: 'not_opted_in', messageIds: [] });
  });

  it('allows replies inside an open window unless the worker opted out', async () => {
    const w = await makeWorker({ lastInboundAt: new Date() });
    const reply = await sendToWorker(db, w.id, { text: 'respuesta', kind: 'reply' });
    expect(reply.ok).toBe(true);

    await db.update(workers).set({ consentStatus: 'opted_out' }).where(eq(workers.id, w.id));
    const blocked = await sendToWorker(db, w.id, { text: 'respuesta', kind: 'reply' });
    expect(blocked).toEqual({ ok: false, reason: 'not_opted_in', messageIds: [] });
  });

  it('allows business sends to opted-in workers (window rules still apply)', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date() });
    const open = await sendToWorker(db, w.id, { text: 'lección', kind: 'business' });
    expect(open.ok).toBe(true);

    await db
      .update(workers)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3600_000) })
      .where(eq(workers.id, w.id));
    const closed = await sendToWorker(db, w.id, { text: 'lección', kind: 'business' });
    expect(closed).toEqual({ ok: false, reason: 'window_closed', messageIds: [] });
  });
});

describe('first inbound message: opt-in + one-time disclosure', () => {
  it('opts the worker in, sends the disclosure exactly once, before the normal reply', async () => {
    const w = await makeWorker();
    expect(w.consentStatus).toBe('pending');

    await injectInbound(w.phoneE164, 'hola');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.consentStatus).toBe('opted_in');
    expect(after.consentMethod).toBe('whatsapp_keyword');
    expect(after.consentedAt).not.toBeNull();
    expect(after.disclosureSentAt).not.toBeNull();

    const texts = await outboundTexts(w.id);
    const disclosureIdx = texts.findIndex((t) =>
      t.includes('registros de capacitación que tu empleador puede ver'),
    );
    const greetingIdx = texts.findIndex((t) => t.includes('Soy Establo, tu ayudante'));
    expect(disclosureIdx).toBeGreaterThanOrEqual(0);
    expect(texts[disclosureIdx]).toContain('BAJA');
    expect(texts[disclosureIdx]).toContain('Compliance Dairy A');
    expect(texts[disclosureIdx]).toContain('notas de voz');
    expect(greetingIdx).toBeGreaterThan(disclosureIdx); // disclosure prepends the reply

    // Second message → no second disclosure.
    await injectInbound(w.phoneE164, 'buenos días');
    const textsAfter = await outboundTexts(w.id);
    const disclosures = textsAfter.filter((t) =>
      t.includes('registros de capacitación que tu empleador puede ver'),
    );
    expect(disclosures).toHaveLength(1);
  });

  it('ALTA opts in with method whatsapp_keyword and confirms', async () => {
    const w = await makeWorker();
    await injectInbound(w.phoneE164, 'ALTA');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.consentStatus).toBe('opted_in');
    expect(after.consentMethod).toBe('whatsapp_keyword');
    const texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('Ya estás dado de alta'))).toBe(true);
  });
});

describe('BAJA opt-out: blocks everything until ALTA', () => {
  it('opt-out works mid-track, confirms once, blocks sends and the drip', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    const { enrollmentId } = await enrollWorker(db, { workerId: w.id, trackId: trackA.id });
    await db
      .update(moduleDeliveries)
      .set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));

    await injectInbound(w.phoneE164, 'BAJA');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.consentStatus).toBe('opted_out');

    const texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('Ya no te mandaremos más mensajes'))).toBe(true);

    // Mid-track drip sends nothing to an opted-out worker.
    const tick = await runDripTick(db);
    const deliveries = await db
      .select()
      .from(moduleDeliveries)
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
    expect(deliveries[0].status).toBe('pending');
    void tick;

    // Even replies are refused now.
    const reply = await sendToWorker(db, w.id, { text: 'respuesta', kind: 'reply' });
    expect(reply.ok).toBe(false);

    // A normal question gets only the "you're opted out" reminder, no answer.
    const before = (await outboundTexts(w.id)).length;
    await injectInbound(w.phoneE164, '¿cuánto tiempo dejo el pre-dip?');
    const now = await outboundTexts(w.id);
    expect(now.length).toBe(before + 1);
    expect(now[now.length - 1]).toContain('Estás dado de baja');

    // ALTA re-joins and the drip resumes (window open: they just wrote).
    await injectInbound(w.phoneE164, 'ALTA');
    const [rejoined] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(rejoined.consentStatus).toBe('opted_in');
    const tick2 = await runDripTick(db);
    expect(tick2.delivered).toBe(1);
  });

  it('honors the variant "no más mensajes"', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    await injectInbound(w.phoneE164, 'no más mensajes');
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.consentStatus).toBe('opted_out');
  });

  it('drip scheduler skips never-opted-in (pending) workers and resumes after opt-in', async () => {
    const w = await makeWorker(); // pending
    const { enrollmentId } = await enrollWorker(db, { workerId: w.id, trackId: trackA.id });
    await db
      .update(moduleDeliveries)
      .set({ scheduledFor: new Date(Date.now() - 60_000) })
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));

    await runDripTick(db);
    const [pending] = await db
      .select()
      .from(moduleDeliveries)
      .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
    expect(pending.status).toBe('pending'); // skipped: no opt-in, not even the template

    await injectInbound(w.phoneE164, 'ALTA');
    const tick = await runDripTick(db);
    expect(tick.delivered).toBe(1);
  });
});

describe('cow care agreement: ACEPTO signature flow', () => {
  it('records the ACEPTO reply as the signature with version and timestamp', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    const outcome = await requestAgreementSignature(db, w.id);
    expect(outcome).toBe('sent');

    const texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('acuerdo de cuidado de las vacas') && t.includes('ACEPTO'))).toBe(true);

    await injectInbound(w.phoneE164, 'ACEPTO');
    const sigs = await db
      .select()
      .from(agreementSignatures)
      .where(eq(agreementSignatures.workerId, w.id));
    expect(sigs).toHaveLength(1);
    expect(sigs[0].method).toBe('whatsapp');
    expect(sigs[0].agreementVersion).toBe(1);
    expect(sigs[0].orgId).toBe(orgA.id);

    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.pendingAgreementId).toBeNull();
    const confirm = await outboundTexts(w.id);
    expect(confirm.some((t) => t.includes('Tu firma quedó registrada'))).toBe(true);
  });

  it('blocks sending the agreement to a non-opted-in worker', async () => {
    const w = await makeWorker({ lastInboundAt: new Date() });
    expect(await requestAgreementSignature(db, w.id)).toBe('blocked');
  });

  it('queues the agreement when the window is closed; the triggering message is not nudged', async () => {
    const w = await makeWorker({
      consentStatus: 'opted_in',
      lastInboundAt: new Date(Date.now() - 30 * 3600_000), // window closed
      disclosureSentAt: new Date(),
    });
    expect(await requestAgreementSignature(db, w.id)).toBe('queued');
    expect((await outboundTexts(w.id)).length).toBe(0); // nothing sent yet

    // Worker writes → agreement delivers; that same message must NOT burn the
    // clarification nudge (they hadn't seen the agreement yet).
    await injectInbound(w.phoneE164, 'buenos dias');
    const texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('acuerdo de cuidado de las vacas'))).toBe(true);
    expect(texts.some((t) => t.includes('Solo me falta tu firma'))).toBe(false);
    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.pendingAgreementNudges).toBe(0);

    // And ACEPTO now signs it.
    await injectInbound(w.phoneE164, 'acepto');
    const sigs = await db
      .select()
      .from(agreementSignatures)
      .where(eq(agreementSignatures.workerId, w.id));
    expect(sigs).toHaveLength(1);
  });

  it('non-ACEPTO replies: one gentle clarification, then escalation to the manager', async () => {
    const w = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date(), disclosureSentAt: new Date() });
    await requestAgreementSignature(db, w.id);

    await injectInbound(w.phoneE164, 'gracias');
    let texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('Solo me falta tu firma'))).toBe(true);
    let escRows = await db
      .select()
      .from(escalations)
      .where(and(eq(escalations.workerId, w.id), like(escalations.reason, '%acuerdo%')));
    expect(escRows).toHaveLength(0);

    await injectInbound(w.phoneE164, 'luego lo veo');
    texts = await outboundTexts(w.id);
    expect(texts.some((t) => t.includes('Le avisé a tu supervisor para que platique contigo sobre el acuerdo'))).toBe(true);
    escRows = await db
      .select()
      .from(escalations)
      .where(and(eq(escalations.workerId, w.id), like(escalations.reason, '%acuerdo%')));
    expect(escRows).toHaveLength(1);

    const [after] = await db.select().from(workers).where(eq(workers.id, w.id));
    expect(after.pendingAgreementId).toBeNull(); // stopped nagging; manager re-sends if needed
  });
});

describe('supervisor sign-off + FARM audit pack', () => {
  let signedWorker: typeof workers.$inferSelect;
  let enrollmentId: string;

  it('owner confirms a completed track; signer name/role/time recorded', async () => {
    signedWorker = await makeWorker({
      name: 'Trabajadora Auditada',
      // 'general' carries all five FARM CE areas, so the letter's gap flags
      // (euthanasia, fitness to transport) below stay expected for her role.
      jobRole: 'general',
      consentStatus: 'opted_in',
      consentedAt: new Date('2026-01-15T12:00:00Z'),
      lastInboundAt: new Date(),
      disclosureSentAt: new Date(),
    });
    const res = await enrollWorker(db, { workerId: signedWorker.id, trackId: trackA.id });
    enrollmentId = res.enrollmentId;
    await db
      .update(enrollments)
      .set({ status: 'completed' })
      .where(eq(enrollments.id, enrollmentId));

    const headers = await ownerSession('owner-a@test.local', 'password-aaa');
    const signoff = await app.inject({
      method: 'POST',
      url: `/api/enrollments/${enrollmentId}/signoff`,
      headers,
      payload: {},
    });
    expect(signoff.statusCode).toBe(200);
    const [enr] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
    expect(enr.signedOffAt).not.toBeNull();
    expect(enr.signedOffName).toBe('Owner A');
    expect(enr.signedOffRole).toBe('owner');

    const again = await app.inject({
      method: 'POST',
      url: `/api/enrollments/${enrollmentId}/signoff`,
      headers,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('audit letter groups by FARM area, flags CE gaps, and shows agreement/sign-off/consent', async () => {
    // Signature for the audited worker.
    const agreement = await getOrCreateActiveAgreement(db, orgA.id);
    await db.insert(agreementSignatures).values({
      orgId: orgA.id,
      workerId: signedWorker.id,
      agreementId: agreement.id,
      agreementVersion: agreement.version,
      method: 'whatsapp',
      signedAt: new Date(),
    });
    // Training events in two FARM areas (leaves euthanasia etc. as gaps).
    await logTrainingEvent(db, {
      orgId: orgA.id,
      workerId: signedWorker.id,
      eventType: 'module_delivered',
      topic: 'Manejo de animales',
      farmTopic: 'stockmanship_general',
      answerText: 'Módulo entregado: Vacas caídas',
      confidence: 'grounded',
    });
    await logTrainingEvent(db, {
      orgId: orgA.id,
      workerId: signedWorker.id,
      eventType: 'qa_interaction',
      topic: 'Cuidado de becerras',
      farmTopic: 'preweaned_calf',
      questionText: '¿cuánto calostro?',
      answerText: '4 litros',
      confidence: 'grounded',
    });

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

    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const letterPath = absPath(`${orgA.id}/audit/${job.id}/training-letter.pdf`);
    const parsed = await pdfParse(await import('node:fs').then((m) => m.promises.readFile(letterPath)));
    const text = parsed.text.replace(/\s+/g, ' ');

    // FARM Animal Care v5 positioning — never Workforce Development, never certification.
    expect(text).toContain('FARM Animal Care');
    expect(text).toContain('Version 5');
    expect(text).not.toContain('Workforce Development');
    expect(text).toContain('does not constitute');
    expect(text).toContain('training records maintained to support your FARM Animal Care evaluation');

    // Grouping + explicit gap flags.
    expect(text).toContain('General animal care & handling');
    expect(text).toContain('Pre-weaned calf care');
    expect(text).toContain('No documented continuing education in: Euthanasia');
    expect(text).toContain('No documented continuing education in: Fitness to transport');

    // Compliance lines for the audited worker.
    expect(text).toContain('Trabajadora Auditada');
    expect(text).toContain('Cow care agreement: Signed v1');
    expect(text).toContain('completion confirmed by Owner A (owner)');
    expect(text).toContain('Messaging consent: Opted in');

    // CSV columns.
    const csv = await import('node:fs').then((m) =>
      m.promises.readFile(absPath(auditCsvPath(orgA.id, job.id)), 'utf8'),
    );
    const header = csv.split('\r\n')[0];
    expect(header).toContain('farm_topic');
    expect(header).toContain('consent_status');
    expect(header).toContain('cow_care_agreement');
    expect(header).toContain('supervisor_sign_off');
    expect(csv).toContain('stockmanship_general');
    expect(csv).toContain('signed v1');
  });
});

describe('template-failure detection and org-wide pause', () => {
  let w: typeof workers.$inferSelect;
  let sid: string;

  it('a category-policy error code on a template failure pauses template sends', async () => {
    w = await makeWorker({
      consentStatus: 'opted_in',
      lastInboundAt: new Date(Date.now() - 30 * 3600_000), // window closed → template path
    });
    const sent = await sendToWorker(db, w.id, {
      text: '',
      template: { name: 'establo_module_notify', vars: ['Ana', 'Lección'] },
    });
    expect(sent.ok).toBe(true);
    sid = sent.ok ? sent.sids[0] : '';

    const cb = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/status',
      payload: new URLSearchParams({
        MessageSid: sid,
        MessageStatus: 'failed',
        ErrorCode: '63049',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(cb.statusCode).toBe(200);

    const [msg] = await db.select().from(messages).where(eq(messages.twilioSid, sid));
    expect(msg.status).toBe('failed');
    expect(msg.errorCode).toBe('63049');

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgA.id));
    expect(org.templateSendsPausedAt).not.toBeNull();
    expect(org.templatePauseReason).toContain('63049');
  });

  it('further template sends are refused (no silent retries) until an owner acknowledges', async () => {
    const refused = await sendToWorker(db, w.id, {
      text: '',
      template: { name: 'establo_module_notify', vars: ['Ana', 'Lección'] },
    });
    expect(refused).toEqual({ ok: false, reason: 'templates_paused', messageIds: [] });

    const headers = await ownerSession('owner-a@test.local', 'password-aaa');
    const alerts = await app.inject({ method: 'GET', url: '/api/alerts', headers });
    expect(JSON.parse(alerts.body).templatePausedAt).not.toBeNull();

    // Another org's owner acknowledging does NOT clear org A's pause.
    const headersB = await ownerSession('owner-b@test.local', 'password-bbb');
    await app.inject({ method: 'POST', url: '/api/alerts/templates/acknowledge', headers: headersB, payload: {} });
    let [org] = await db.select().from(orgs).where(eq(orgs.id, orgA.id));
    expect(org.templateSendsPausedAt).not.toBeNull();

    const ack = await app.inject({
      method: 'POST',
      url: '/api/alerts/templates/acknowledge',
      headers,
      payload: {},
    });
    expect(ack.statusCode).toBe(200);
    [org] = await db.select().from(orgs).where(eq(orgs.id, orgA.id));
    expect(org.templateSendsPausedAt).toBeNull();

    const resumed = await sendToWorker(db, w.id, {
      text: '',
      template: { name: 'establo_module_notify', vars: ['Ana', 'Lección'] },
    });
    expect(resumed.ok).toBe(true);
  });

  it('non-policy error codes do not pause the org', async () => {
    const sent = await sendToWorker(db, w.id, {
      text: '',
      template: { name: 'establo_check_reminder', vars: ['Ana', 'Lección'] },
    });
    expect(sent.ok).toBe(true);
    await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/status',
      payload: new URLSearchParams({
        MessageSid: sent.ok ? sent.sids[0] : '',
        MessageStatus: 'failed',
        ErrorCode: '30007', // carrier filtering — not a template/category problem
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgA.id));
    expect(org.templateSendsPausedAt).toBeNull();
  });
});

describe('cross-tenant isolation for the new tables', () => {
  it("org B cannot touch org A's consent, agreements, or sign-offs", async () => {
    const wA = await makeWorker({ consentStatus: 'opted_in', lastInboundAt: new Date() });
    const { enrollmentId } = await enrollWorker(db, { workerId: wA.id, trackId: trackA.id });
    await db.update(enrollments).set({ status: 'completed' }).where(eq(enrollments.id, enrollmentId));

    const headersB = await ownerSession('owner-b@test.local', 'password-bbb');

    const consent = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/consent/paper`,
      headers: headersB,
      payload: { attestedBy: 'Owner B' },
    });
    expect(consent.statusCode).toBe(404);

    const agreementSend = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/agreement/send`,
      headers: headersB,
      payload: {},
    });
    expect(agreementSend.statusCode).toBe(404);

    const agreementPaper = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/agreement/paper`,
      headers: headersB,
      payload: { attestedBy: 'Owner B' },
    });
    expect(agreementPaper.statusCode).toBe(404);

    const signoff = await app.inject({
      method: 'POST',
      url: `/api/enrollments/${enrollmentId}/signoff`,
      headers: headersB,
      payload: {},
    });
    expect(signoff.statusCode).toBe(404);

    // Agreements are versioned per org — org B sees its own v1, not org A's edits.
    const headersA = await ownerSession('owner-a@test.local', 'password-aaa');
    await app.inject({
      method: 'PATCH',
      url: '/api/agreement',
      headers: headersA,
      payload: { textEs: 'ACUERDO PROPIO DE LA LECHERÍA A — compromisos de buen trato actualizados para la versión dos.' },
    });
    const agreementB = await app.inject({ method: 'GET', url: '/api/agreement', headers: headersB });
    const bodyB = JSON.parse(agreementB.body);
    expect(bodyB.version).toBe(1);
    expect(bodyB.textEs).not.toContain('LECHERÍA A');
  });

  it('paper consent requires attestation and works inside the org', async () => {
    const wA = await makeWorker(); // pending
    const headersA = await ownerSession('owner-a@test.local', 'password-aaa');

    const missing = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/consent/paper`,
      headers: headersA,
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/consent/paper`,
      headers: headersA,
      payload: { attestedBy: 'Owner A' },
    });
    expect(ok.statusCode).toBe(200);
    const [after] = await db.select().from(workers).where(eq(workers.id, wA.id));
    expect(after.consentStatus).toBe('opted_in');
    expect(after.consentMethod).toBe('paper_form');
    expect(after.consentAttestedBy).toBe('Owner A');
  });

  it('paper consent can never override a worker BAJA', async () => {
    const wA = await makeWorker({ consentStatus: 'opted_out' });
    const headersA = await ownerSession('owner-a@test.local', 'password-aaa');
    const res = await app.inject({
      method: 'POST',
      url: `/api/workers/${wA.id}/consent/paper`,
      headers: headersA,
      payload: { attestedBy: 'Owner A' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POLICY-SCOPE: open-domain questions are refused, not answered', () => {
  it('refuses "¿quién ganó el mundial?" via the similarity floor (production default)', async () => {
    // Pin the floor to the documented real-embeddings default; the keyless
    // stub floor (0.02) is deliberately forgiving and would leak an extract.
    process.env.RETRIEVAL_MIN_SIMILARITY = '0.25';
    resetConfigForTests();
    try {
      const result = await answerQuestion(db, orgA.id, '¿quién ganó el mundial?');
      expect(result.confidence).toBe('not_found');
      expect(result.text).not.toContain('📄 Fuente');
      expect(result.sourceChunkIds).toHaveLength(0);
    } finally {
      delete process.env.RETRIEVAL_MIN_SIMILARITY;
      resetConfigForTests();
    }
  });
});
