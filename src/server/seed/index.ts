import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { closeDb, getDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  conversations,
  enrollments,
  escalations,
  messages,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  sopDocuments,
  trainingEvents,
  users,
  workers,
} from '../db/schema.js';
import { saveBuffer } from '../lib/storage.js';
import { generateCertificate } from '../services/certificates.js';
import { ingestDocument } from '../services/ingestion.js';
import { usingStubEmbeddings } from '../services/embeddings.js';
import { synthesizeSpeech } from '../services/speech.js';
import {
  DEMO_MODULES,
  DEMO_ORG,
  DEMO_OWNER,
  DEMO_QA_POOL,
  DEMO_SOPS,
  DEMO_TRACK,
  DEMO_WORKERS,
} from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deterministic RNG so the seed is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boiseTime(daysAgo: number, hour: number, minute = 0): Date {
  return DateTime.now()
    .setZone(DEMO_ORG.timezone)
    .minus({ days: daysAgo })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

async function wipeExistingDemoOrg(db: Db): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, DEMO_OWNER.email));
  if (existing.length > 0) {
    await db.delete(orgs).where(eq(orgs.id, existing[0].orgId));
  }
  // Also clear demo phone numbers left by older seeds (phone is globally unique).
  await db.delete(workers).where(
    inArray(
      workers.phoneE164,
      DEMO_WORKERS.map((w) => w.phone),
    ),
  );
}

export async function seed(): Promise<void> {
  await runMigrations();
  const db = getDb();
  const rand = mulberry32(42);

  console.log('🌱 Seeding Establo demo data…');
  if (usingStubEmbeddings()) {
    console.log('   (no OPENAI_API_KEY — using deterministic stub embeddings)');
  }

  await wipeExistingDemoOrg(db);

  // ── Org + owner ────────────────────────────────────────────────────────────
  const [org] = await db
    .insert(orgs)
    .values({
      name: DEMO_ORG.name,
      timezone: DEMO_ORG.timezone,
      locale: DEMO_ORG.locale,
      herdSize: DEMO_ORG.herdSize,
      settings: { city: 'Jerome', state: 'Idaho' },
    })
    .returning();

  await db.insert(users).values({
    orgId: org.id,
    email: DEMO_OWNER.email,
    passwordHash: await argon2.hash(DEMO_OWNER.password),
    role: DEMO_OWNER.role,
    name: DEMO_OWNER.name,
  });
  console.log(`✓ Org "${org.name}" + owner ${DEMO_OWNER.email}`);

  // ── Workers ────────────────────────────────────────────────────────────────
  const now = Date.now();
  const workerRows = await db
    .insert(workers)
    .values(
      DEMO_WORKERS.map((w) => ({
        orgId: org.id,
        name: w.name,
        phoneE164: w.phone,
        preferredLanguage: 'es',
        status: 'active' as const,
        hiredAt: new Date(now - w.daysEmployed * 86_400_000),
        lastInboundAt: new Date(now - w.hoursAgo * 3_600_000),
      })),
    )
    .returning();
  console.log(`✓ ${workerRows.length} workers`);

  // ── SOP documents (ingest + embed) ────────────────────────────────────────
  const docIdByKey = new Map<string, string>();
  for (const sop of DEMO_SOPS) {
    const sourcePath = path.join(__dirname, 'sops', sop.file);
    const content = await fs.promises.readFile(sourcePath);
    const [doc] = await db
      .insert(sopDocuments)
      .values({
        orgId: org.id,
        title: sop.title,
        originalFilename: sop.file,
        mimeType: 'text/markdown',
        status: 'uploaded',
        language: 'es',
      })
      .returning();
    const rel = `${org.id}/sops/${doc.id}/${sop.file}`;
    await saveBuffer(rel, content);
    await db
      .update(sopDocuments)
      .set({ storagePath: rel })
      .where(eq(sopDocuments.id, doc.id));
    await ingestDocument(db, doc.id);
    docIdByKey.set(sop.key, doc.id);
    console.log(`✓ SOP ingested: ${sop.title}`);
  }

  // ── Onboarding track + modules ────────────────────────────────────────────
  const [track] = await db
    .insert(onboardingTracks)
    .values({ orgId: org.id, name: DEMO_TRACK.name, description: DEMO_TRACK.description })
    .returning();

  const moduleRows = await db
    .insert(modules)
    .values(
      DEMO_MODULES.map((m, i) => ({
        trackId: track.id,
        orgId: org.id,
        orderIndex: i,
        dayOffset: m.dayOffset,
        sendHourLocal: m.sendHourLocal,
        title: m.title,
        bodyEs: m.bodyEs,
        checkQuestionEs: m.checkQuestionEs,
        checkOptionsEs: m.checkOptionsEs,
        checkCorrectIndex: m.checkCorrectIndex,
        sourceDocumentId: docIdByKey.get(m.sopKey) ?? null,
      })),
    )
    .returning();
  console.log(`✓ Track "${track.name}" with ${moduleRows.length} modules`);

  const moduleTopic = (i: number) =>
    ['Ordeño', 'Ordeño', 'Químicos y seguridad', 'Manejo de animales', 'Cuidado de becerras', 'Higiene'][i] ?? 'Otro';

  // ── María: completed the track (enrolled 20 days ago) ─────────────────────
  const maria = workerRows[0];
  const [mariaEnr] = await db
    .insert(enrollments)
    .values({
      workerId: maria.id,
      trackId: track.id,
      orgId: org.id,
      startedAt: boiseTime(20, 6, 30),
      status: 'completed',
    })
    .returning();
  for (let i = 0; i < moduleRows.length; i++) {
    const m = moduleRows[i];
    const sentAt = boiseTime(20 - DEMO_MODULES[i].dayOffset, 7);
    const answeredAt = new Date(sentAt.getTime() + (1 + Math.floor(rand() * 5)) * 3_600_000);
    const passed = i !== 2; // she missed the chemicals check once
    const answerIndex = passed
      ? m.checkCorrectIndex
      : (m.checkCorrectIndex + 1) % m.checkOptionsEs.length;
    await db.insert(moduleDeliveries).values({
      enrollmentId: mariaEnr.id,
      moduleId: m.id,
      orgId: org.id,
      scheduledFor: sentAt,
      status: 'answered',
      sentAt,
      checkAnsweredAt: answeredAt,
      checkAnswerIndex: answerIndex,
      checkPassed: passed,
    });
    await db.insert(trainingEvents).values([
      {
        orgId: org.id,
        workerId: maria.id,
        occurredAt: sentAt,
        eventType: 'module_delivered',
        topic: moduleTopic(i),
        questionText: null,
        answerText: `Módulo entregado: ${m.title}`,
        sourceDocumentId: m.sourceDocumentId,
        confidence: 'grounded',
      },
      {
        orgId: org.id,
        workerId: maria.id,
        occurredAt: answeredAt,
        eventType: passed ? 'check_passed' : 'check_failed',
        topic: moduleTopic(i),
        questionText: m.checkQuestionEs,
        answerText: `Respuesta: ${answerIndex + 1}) ${m.checkOptionsEs[answerIndex]}`,
        sourceDocumentId: m.sourceDocumentId,
        confidence: 'grounded',
      },
    ]);
  }
  await generateCertificate(db, mariaEnr.id);
  console.log(`✓ ${maria.name}: track completed + certificate generated`);

  // ── Pedro: new hire, mid-track (enrolled 3 days ago) ──────────────────────
  const pedro = workerRows[5];
  const [pedroEnr] = await db
    .insert(enrollments)
    .values({
      workerId: pedro.id,
      trackId: track.id,
      orgId: org.id,
      startedAt: boiseTime(3, 6, 0),
      status: 'active',
    })
    .returning();
  for (let i = 0; i < moduleRows.length; i++) {
    const m = moduleRows[i];
    const offset = DEMO_MODULES[i].dayOffset;
    const scheduled = boiseTime(3 - offset, 7);
    if (offset <= 2) {
      const answeredAt = new Date(scheduled.getTime() + (1 + Math.floor(rand() * 4)) * 3_600_000);
      const passed = i !== 2;
      const answerIndex = passed
        ? m.checkCorrectIndex
        : (m.checkCorrectIndex + 2) % m.checkOptionsEs.length;
      await db.insert(moduleDeliveries).values({
        enrollmentId: pedroEnr.id,
        moduleId: m.id,
        orgId: org.id,
        scheduledFor: scheduled,
        status: 'answered',
        sentAt: scheduled,
        checkAnsweredAt: answeredAt,
        checkAnswerIndex: answerIndex,
        checkPassed: passed,
      });
      await db.insert(trainingEvents).values([
        {
          orgId: org.id,
          workerId: pedro.id,
          occurredAt: scheduled,
          eventType: 'module_delivered',
          topic: moduleTopic(i),
          answerText: `Módulo entregado: ${m.title}`,
          sourceDocumentId: m.sourceDocumentId,
          confidence: 'grounded',
        },
        {
          orgId: org.id,
          workerId: pedro.id,
          occurredAt: answeredAt,
          eventType: passed ? 'check_passed' : 'check_failed',
          topic: moduleTopic(i),
          questionText: m.checkQuestionEs,
          answerText: `Respuesta: ${answerIndex + 1}) ${m.checkOptionsEs[answerIndex]}`,
          sourceDocumentId: m.sourceDocumentId,
          confidence: 'grounded',
        },
      ]);
    } else {
      await db.insert(moduleDeliveries).values({
        enrollmentId: pedroEnr.id,
        moduleId: m.id,
        orgId: org.id,
        scheduledFor: scheduled,
        status: 'pending',
      });
    }
  }
  console.log(`✓ ${pedro.name}: enrolled, 3 of 6 modules delivered`);

  // ── Two weeks of Q&A history + escalations + recent conversations ─────────
  const convByWorker = new Map<string, string>();
  async function conversationFor(workerId: string, at: Date): Promise<string> {
    const existing = convByWorker.get(workerId);
    if (existing) return existing;
    const [conv] = await db
      .insert(conversations)
      .values({ workerId, orgId: org.id, startedAt: at, lastMessageAt: at })
      .returning();
    convByWorker.set(workerId, conv.id);
    return conv.id;
  }

  let qaCount = 0;
  let escalationCount = 0;
  const escalationStatuses: Array<'open' | 'open' | 'resolved'> = ['open', 'open', 'resolved'];
  let poolCursor = 0;

  for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
    const interactions = 2 + Math.floor(rand() * 3); // 2–4 per day
    for (let k = 0; k < interactions; k++) {
      const qa = DEMO_QA_POOL[poolCursor % DEMO_QA_POOL.length];
      poolCursor++;
      // Pedro only has history in his 3 employed days.
      const eligible = workerRows.filter((_, idx) => (idx === 5 ? daysAgo <= 3 : true));
      const worker = eligible[Math.floor(rand() * eligible.length)];
      const hour = 5 + Math.floor(rand() * 13);
      const at = boiseTime(daysAgo, hour, Math.floor(rand() * 59));
      if (at.getTime() > now) continue;

      const isNotFound = qa.confidence === 'not_found';
      const answerText = isNotFound
        ? 'No tengo esa información en los procedimientos de tu lechería. 🙏 Por favor pregunta a tu supervisor. Ya avisé al equipo para que lo revisen.'
        : qa.answer;

      await db.insert(trainingEvents).values({
        orgId: org.id,
        workerId: worker.id,
        occurredAt: at,
        eventType: 'qa_interaction',
        topic: qa.topic,
        questionText: qa.question,
        answerText,
        sourceDocumentId: qa.sopKey ? (docIdByKey.get(qa.sopKey) ?? null) : null,
        confidence: qa.confidence,
      });
      qaCount++;

      if (isNotFound && escalationCount < escalationStatuses.length) {
        const status = escalationStatuses[escalationCount];
        await db.insert(escalations).values({
          orgId: org.id,
          workerId: worker.id,
          questionText: qa.question,
          reason: 'No encontrado en los SOPs',
          status,
          createdAt: at,
          updatedAt: at,
        });
        await db.insert(trainingEvents).values({
          orgId: org.id,
          workerId: worker.id,
          occurredAt: at,
          eventType: 'escalation',
          topic: qa.topic,
          questionText: qa.question,
          confidence: 'not_found',
        });
        escalationCount++;
      }

      // Recent interactions also appear as WhatsApp conversations.
      if (daysAgo <= 3) {
        const convId = await conversationFor(worker.id, at);
        const audio =
          qa.voice && daysAgo <= 1 ? await synthesizeSpeech(answerText) : null;
        await db.insert(messages).values([
          {
            conversationId: convId,
            orgId: org.id,
            direction: 'inbound',
            type: qa.voice ? 'voice' : 'text',
            bodyText: qa.voice ? null : qa.question,
            transcriptText: qa.voice ? qa.question : null,
            mediaUrl: qa.voice ? 'seed://voice-note' : null,
            status: 'received',
            createdAt: at,
            updatedAt: at,
          },
          {
            conversationId: convId,
            orgId: org.id,
            direction: 'outbound',
            type: 'text',
            bodyText: answerText,
            audioReplyUrl: audio?.publicUrl ?? null,
            status: 'delivered',
            createdAt: new Date(at.getTime() + 8000),
            updatedAt: new Date(at.getTime() + 8000),
          },
        ]);
        await db
          .update(conversations)
          .set({ lastMessageAt: new Date(at.getTime() + 8000) })
          .where(eq(conversations.id, convId));
      }
    }
  }
  console.log(`✓ ${qaCount} historical Q&A training events, ${escalationCount} escalations`);

  console.log('\n🎉 Seed complete!\n');
  console.log('  Dashboard login:');
  console.log(`    email:    ${DEMO_OWNER.email}`);
  console.log(`    password: ${DEMO_OWNER.password}`);
  console.log('  Open http://localhost:5173/app (pnpm dev) and try the Simulator page.');
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  seed()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
