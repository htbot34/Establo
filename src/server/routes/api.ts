import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { getDb } from '../db/client.js';
import {
  auditExports,
  conversations,
  enrollments,
  escalations,
  messages,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  sopChunks,
  sopDocuments,
  trainingEvents,
  workers,
} from '../db/schema.js';
import { config } from '../config.js';
import { isValidE164 } from '../lib/phone.js';
import { absPath, saveBuffer } from '../lib/storage.js';
import { dispatch } from '../jobs/boss.js';
import { certificateRelPath } from '../services/certificates.js';
import { enrollWorker, runDripTick } from '../services/drip.js';
import { isImageMime } from '../services/ingestion.js';
import { anthropicAvailable, extractJson, generateText } from '../services/llm.js';
import { generateWorkerTranscriptPdf } from '../services/transcripts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_PROMPT = path.resolve(__dirname, '../../../prompts/modules.es.md');

const FILE_MIMES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function registerApiRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', requireAuth);

  // ── Overview ───────────────────────────────────────────────────────────────
  app.get('/api/overview', async (req) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600_000);

    const [activeWorkers] = await db
      .select({ n: count() })
      .from(workers)
      .where(and(eq(workers.orgId, orgId), eq(workers.status, 'active')));
    const [questionsWeek] = await db
      .select({ n: count() })
      .from(trainingEvents)
      .where(
        and(
          eq(trainingEvents.orgId, orgId),
          eq(trainingEvents.eventType, 'qa_interaction'),
          gte(trainingEvents.occurredAt, weekAgo),
        ),
      );
    const [modulesWeek] = await db
      .select({ n: count() })
      .from(trainingEvents)
      .where(
        and(
          eq(trainingEvents.orgId, orgId),
          eq(trainingEvents.eventType, 'module_delivered'),
          gte(trainingEvents.occurredAt, weekAgo),
        ),
      );
    const [openGaps] = await db
      .select({ n: count() })
      .from(escalations)
      .where(and(eq(escalations.orgId, orgId), eq(escalations.status, 'open')));

    const tz = req.authOrg!.timezone;
    const sparkRows = await db
      .select({
        day: sql<string>`to_char(${trainingEvents.occurredAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(trainingEvents)
      .where(and(eq(trainingEvents.orgId, orgId), gte(trainingEvents.occurredAt, twoWeeksAgo)))
      .groupBy(sql`1`);
    const byDay = new Map(sparkRows.map((r) => [r.day, Number(r.n)]));
    const sparkline: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600_000);
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      sparkline.push({ date: key, count: byDay.get(key) ?? 0 });
    }

    const recentEscalations = await db
      .select({ esc: escalations, workerName: workers.name })
      .from(escalations)
      .innerJoin(workers, eq(escalations.workerId, workers.id))
      .where(eq(escalations.orgId, orgId))
      .orderBy(desc(escalations.createdAt))
      .limit(6);

    return {
      activeWorkers: Number(activeWorkers.n),
      questionsThisWeek: Number(questionsWeek.n),
      modulesDeliveredThisWeek: Number(modulesWeek.n),
      openKnowledgeGaps: Number(openGaps.n),
      sparkline,
      recentEscalations: recentEscalations.map((r) => ({
        id: r.esc.id,
        workerName: r.workerName,
        questionText: r.esc.questionText,
        reason: r.esc.reason,
        status: r.esc.status,
        createdAt: r.esc.createdAt,
      })),
    };
  });

  // ── SOP documents ─────────────────────────────────────────────────────────
  app.get('/api/sops', async (req) => {
    const db = getDb();
    const rows = await db
      .select({
        doc: sopDocuments,
        chunkCount: sql<number>`(SELECT count(*) FROM ${sopChunks} WHERE ${sopChunks.documentId} = ${sopDocuments.id})`,
      })
      .from(sopDocuments)
      .where(eq(sopDocuments.orgId, req.authOrg!.id))
      .orderBy(desc(sopDocuments.createdAt));
    return rows.map(({ doc, chunkCount }) => ({ ...doc, chunkCount: Number(chunkCount) }));
  });

  app.post('/api/sops/upload', async (req, reply) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const files: Array<{ filename: string; mimetype: string; buffer: Buffer }> = [];
    let title = '';
    let asPages = false;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        files.push({
          filename: part.filename ?? 'archivo',
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        });
      } else if (part.fieldname === 'title') {
        title = String(part.value ?? '').trim();
      } else if (part.fieldname === 'asPages') {
        asPages = String(part.value) === 'true';
      }
    }
    if (files.length === 0) return reply.code(400).send({ error: 'No files uploaded' });

    const created: Array<{ id: string; title: string }> = [];
    const allImages = files.every((f) => isImageMime(f.mimetype));

    if (asPages && allImages && files.length > 0) {
      // Multiple photos of one paper SOP → a single multi-page document.
      const docTitle = title || files[0].filename.replace(/\.[^.]+$/, '');
      const [doc] = await db
        .insert(sopDocuments)
        .values({
          orgId,
          title: docTitle,
          originalFilename: files.map((f) => f.filename).join(', '),
          mimeType: 'establo/image-pages',
          status: 'uploaded',
        })
        .returning();
      const dir = `${orgId}/sops/${doc.id}`;
      for (let i = 0; i < files.length; i++) {
        const ext = path.extname(files[i].filename) || '.jpg';
        await saveBuffer(`${dir}/page-${String(i + 1).padStart(3, '0')}${ext}`, files[i].buffer);
      }
      await db
        .update(sopDocuments)
        .set({ storagePath: dir })
        .where(eq(sopDocuments.id, doc.id));
      await dispatch('sop-ingest', { documentId: doc.id });
      created.push({ id: doc.id, title: docTitle });
    } else {
      for (const file of files) {
        const docTitle =
          files.length === 1 && title ? title : file.filename.replace(/\.[^.]+$/, '');
        const isImage = isImageMime(file.mimetype);
        const [doc] = await db
          .insert(sopDocuments)
          .values({
            orgId,
            title: docTitle,
            originalFilename: file.filename,
            mimeType: isImage ? 'establo/image-pages' : file.mimetype,
            status: 'uploaded',
          })
          .returning();
        const rel = isImage
          ? `${orgId}/sops/${doc.id}/page-001${path.extname(file.filename) || '.jpg'}`
          : `${orgId}/sops/${doc.id}/${file.filename}`;
        await saveBuffer(rel, file.buffer);
        await db
          .update(sopDocuments)
          .set({ storagePath: isImage ? `${orgId}/sops/${doc.id}` : rel })
          .where(eq(sopDocuments.id, doc.id));
        await dispatch('sop-ingest', { documentId: doc.id });
        created.push({ id: doc.id, title: docTitle });
      }
    }
    return { created };
  });

  app.get<{ Params: { id: string } }>('/api/sops/:id', async (req, reply) => {
    const db = getDb();
    const [doc] = await db
      .select()
      .from(sopDocuments)
      .where(and(eq(sopDocuments.id, req.params.id), eq(sopDocuments.orgId, req.authOrg!.id)));
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    const chunks = await db
      .select({
        id: sopChunks.id,
        chunkIndex: sopChunks.chunkIndex,
        headingPath: sopChunks.headingPath,
        content: sopChunks.content,
        tokenCount: sopChunks.tokenCount,
      })
      .from(sopChunks)
      .where(eq(sopChunks.documentId, doc.id))
      .orderBy(asc(sopChunks.chunkIndex));
    return { ...doc, chunks };
  });

  app.delete<{ Params: { id: string } }>('/api/sops/:id', async (req, reply) => {
    const db = getDb();
    const deleted = await db
      .delete(sopDocuments)
      .where(and(eq(sopDocuments.id, req.params.id), eq(sopDocuments.orgId, req.authOrg!.id)))
      .returning({ id: sopDocuments.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Document not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/sops/:id/reingest', async (req, reply) => {
    const db = getDb();
    const [doc] = await db
      .select()
      .from(sopDocuments)
      .where(and(eq(sopDocuments.id, req.params.id), eq(sopDocuments.orgId, req.authOrg!.id)));
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    await db
      .update(sopDocuments)
      .set({ status: 'processing', errorText: null })
      .where(eq(sopDocuments.id, doc.id));
    await dispatch('sop-ingest', { documentId: doc.id });
    return { ok: true };
  });

  // ── Workers ───────────────────────────────────────────────────────────────
  app.get('/api/workers', async (req) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const rows = await db
      .select()
      .from(workers)
      .where(eq(workers.orgId, orgId))
      .orderBy(asc(workers.name));
    const enrs = await db
      .select({ enr: enrollments, trackName: onboardingTracks.name })
      .from(enrollments)
      .innerJoin(onboardingTracks, eq(enrollments.trackId, onboardingTracks.id))
      .where(eq(enrollments.orgId, orgId))
      .orderBy(desc(enrollments.createdAt));
    const deliveryAgg = await db
      .select({
        enrollmentId: moduleDeliveries.enrollmentId,
        total: count(),
        answered: sql<number>`count(*) FILTER (WHERE ${moduleDeliveries.status} = 'answered')`,
      })
      .from(moduleDeliveries)
      .where(eq(moduleDeliveries.orgId, orgId))
      .groupBy(moduleDeliveries.enrollmentId);
    const aggByEnr = new Map(deliveryAgg.map((d) => [d.enrollmentId, d]));
    const latestEnrByWorker = new Map<string, (typeof enrs)[number]>();
    for (const e of enrs) {
      if (!latestEnrByWorker.has(e.enr.workerId)) latestEnrByWorker.set(e.enr.workerId, e);
    }
    return rows.map((w) => {
      const e = latestEnrByWorker.get(w.id);
      const agg = e ? aggByEnr.get(e.enr.id) : undefined;
      return {
        ...w,
        enrollment: e
          ? {
              id: e.enr.id,
              trackName: e.trackName,
              status: e.enr.status,
              modulesAnswered: Number(agg?.answered ?? 0),
              modulesTotal: Number(agg?.total ?? 0),
            }
          : null,
      };
    });
  });

  const workerSchema = z.object({
    name: z.string().min(1).max(120),
    phoneE164: z.string().refine(isValidE164, 'Phone must be E.164 format, e.g. +12085551234'),
    notes: z.string().max(2000).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional(),
  });

  app.post('/api/workers', async (req, reply) => {
    const parsed = workerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const db = getDb();
    const existing = await db
      .select()
      .from(workers)
      .where(eq(workers.phoneE164, parsed.data.phoneE164));
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'A worker with that phone number already exists' });
    }
    const [row] = await db
      .insert(workers)
      .values({
        orgId: req.authOrg!.id,
        name: parsed.data.name,
        phoneE164: parsed.data.phoneE164,
        notes: parsed.data.notes ?? null,
        hiredAt: new Date(),
      })
      .returning();
    return row;
  });

  app.patch<{ Params: { id: string } }>('/api/workers/:id', async (req, reply) => {
    const parsed = workerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const db = getDb();
    const [row] = await db
      .update(workers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(workers.id, req.params.id), eq(workers.orgId, req.authOrg!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Worker not found' });
    return row;
  });

  app.get<{ Params: { id: string } }>('/api/workers/:id', async (req, reply) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const [worker] = await db
      .select()
      .from(workers)
      .where(and(eq(workers.id, req.params.id), eq(workers.orgId, orgId)));
    if (!worker) return reply.code(404).send({ error: 'Worker not found' });

    const enrs = await db
      .select({ enr: enrollments, trackName: onboardingTracks.name })
      .from(enrollments)
      .innerJoin(onboardingTracks, eq(enrollments.trackId, onboardingTracks.id))
      .where(eq(enrollments.workerId, worker.id))
      .orderBy(desc(enrollments.createdAt));

    const enrollmentDetails = [];
    for (const { enr, trackName } of enrs) {
      const deliveries = await db
        .select({ delivery: moduleDeliveries, moduleTitle: modules.title, orderIndex: modules.orderIndex })
        .from(moduleDeliveries)
        .innerJoin(modules, eq(moduleDeliveries.moduleId, modules.id))
        .where(eq(moduleDeliveries.enrollmentId, enr.id))
        .orderBy(asc(modules.orderIndex));
      const certRel = certificateRelPath(orgId, enr.id);
      enrollmentDetails.push({
        id: enr.id,
        trackName,
        status: enr.status,
        startedAt: enr.startedAt,
        certificateUrl:
          enr.status === 'completed' && fs.existsSync(absPath(certRel))
            ? `/api/files/${certRel}`
            : null,
        deliveries: deliveries.map((d) => ({
          id: d.delivery.id,
          moduleTitle: d.moduleTitle,
          orderIndex: d.orderIndex,
          status: d.delivery.status,
          scheduledFor: d.delivery.scheduledFor,
          sentAt: d.delivery.sentAt,
          checkAnsweredAt: d.delivery.checkAnsweredAt,
          checkPassed: d.delivery.checkPassed,
        })),
      });
    }

    const events = await db
      .select({ ev: trainingEvents, docTitle: sopDocuments.title })
      .from(trainingEvents)
      .leftJoin(sopDocuments, eq(trainingEvents.sourceDocumentId, sopDocuments.id))
      .where(and(eq(trainingEvents.workerId, worker.id), eq(trainingEvents.orgId, orgId)))
      .orderBy(desc(trainingEvents.occurredAt))
      .limit(300);

    return {
      ...worker,
      enrollments: enrollmentDetails,
      events: events.map(({ ev, docTitle }) => ({ ...ev, sourceDocumentTitle: docTitle })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/workers/:id/enroll', async (req, reply) => {
    const body = z.object({ trackId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'trackId required' });
    const db = getDb();
    const orgId = req.authOrg!.id;
    const [worker] = await db
      .select()
      .from(workers)
      .where(and(eq(workers.id, req.params.id), eq(workers.orgId, orgId)));
    if (!worker) return reply.code(404).send({ error: 'Worker not found' });
    const [track] = await db
      .select()
      .from(onboardingTracks)
      .where(and(eq(onboardingTracks.id, body.data.trackId), eq(onboardingTracks.orgId, orgId)));
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    const result = await enrollWorker(db, { workerId: worker.id, trackId: track.id });
    return result;
  });

  app.get<{ Params: { id: string } }>('/api/workers/:id/transcript.pdf', async (req, reply) => {
    const db = getDb();
    const [worker] = await db
      .select()
      .from(workers)
      .where(and(eq(workers.id, req.params.id), eq(workers.orgId, req.authOrg!.id)));
    if (!worker) return reply.code(404).send({ error: 'Worker not found' });
    const buffer = await generateWorkerTranscriptPdf(db, worker.id);
    const safe = worker.name.replace(/[^a-zA-Z0-9]+/g, '-');
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="transcript-${safe}.pdf"`)
      .send(buffer);
  });

  // ── Onboarding tracks & modules ───────────────────────────────────────────
  app.get('/api/tracks', async (req) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const tracks = await db
      .select()
      .from(onboardingTracks)
      .where(eq(onboardingTracks.orgId, orgId))
      .orderBy(asc(onboardingTracks.createdAt));
    const moduleCounts = await db
      .select({ trackId: modules.trackId, n: count() })
      .from(modules)
      .where(eq(modules.orgId, orgId))
      .groupBy(modules.trackId);
    const enrollCounts = await db
      .select({
        trackId: enrollments.trackId,
        active: sql<number>`count(*) FILTER (WHERE ${enrollments.status} = 'active')`,
        completed: sql<number>`count(*) FILTER (WHERE ${enrollments.status} = 'completed')`,
      })
      .from(enrollments)
      .where(eq(enrollments.orgId, orgId))
      .groupBy(enrollments.trackId);
    const mc = new Map(moduleCounts.map((m) => [m.trackId, Number(m.n)]));
    const ec = new Map(enrollCounts.map((e) => [e.trackId, e]));
    return tracks.map((t) => ({
      ...t,
      moduleCount: mc.get(t.id) ?? 0,
      activeEnrollments: Number(ec.get(t.id)?.active ?? 0),
      completedEnrollments: Number(ec.get(t.id)?.completed ?? 0),
    }));
  });

  const trackSchema = z.object({
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional().nullable(),
    active: z.boolean().optional(),
  });

  app.post('/api/tracks', async (req, reply) => {
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Track name required' });
    const db = getDb();
    const [row] = await db
      .insert(onboardingTracks)
      .values({
        orgId: req.authOrg!.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();
    return row;
  });

  app.get<{ Params: { id: string } }>('/api/tracks/:id', async (req, reply) => {
    const db = getDb();
    const [track] = await db
      .select()
      .from(onboardingTracks)
      .where(
        and(eq(onboardingTracks.id, req.params.id), eq(onboardingTracks.orgId, req.authOrg!.id)),
      );
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    const mods = await db
      .select()
      .from(modules)
      .where(eq(modules.trackId, track.id))
      .orderBy(asc(modules.orderIndex));
    return { ...track, modules: mods };
  });

  app.patch<{ Params: { id: string } }>('/api/tracks/:id', async (req, reply) => {
    const parsed = trackSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const db = getDb();
    const [row] = await db
      .update(onboardingTracks)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(eq(onboardingTracks.id, req.params.id), eq(onboardingTracks.orgId, req.authOrg!.id)),
      )
      .returning();
    if (!row) return reply.code(404).send({ error: 'Track not found' });
    return row;
  });

  const moduleSchema = z.object({
    title: z.string().min(1).max(160),
    bodyEs: z.string().min(1).max(900, 'Lesson body must stay under 900 characters'),
    checkQuestionEs: z.string().min(1).max(300),
    checkOptionsEs: z.array(z.string().min(1).max(120)).length(3),
    checkCorrectIndex: z.number().int().min(0).max(2),
    dayOffset: z.number().int().min(0).max(60),
    sendHourLocal: z.number().int().min(5).max(20).default(7),
  });

  app.post<{ Params: { id: string } }>('/api/tracks/:id/modules', async (req, reply) => {
    const parsed = moduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid module' });
    }
    const db = getDb();
    const orgId = req.authOrg!.id;
    const [track] = await db
      .select()
      .from(onboardingTracks)
      .where(and(eq(onboardingTracks.id, req.params.id), eq(onboardingTracks.orgId, orgId)));
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(${modules.orderIndex}), -1)` })
      .from(modules)
      .where(eq(modules.trackId, track.id));
    const [row] = await db
      .insert(modules)
      .values({
        trackId: track.id,
        orgId,
        orderIndex: Number(maxRow.max) + 1,
        ...parsed.data,
      })
      .returning();
    return row;
  });

  app.patch<{ Params: { id: string } }>('/api/modules/:id', async (req, reply) => {
    const parsed = moduleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid module' });
    }
    const db = getDb();
    const [row] = await db
      .update(modules)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(modules.id, req.params.id), eq(modules.orgId, req.authOrg!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Module not found' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/modules/:id', async (req, reply) => {
    const db = getDb();
    const deleted = await db
      .delete(modules)
      .where(and(eq(modules.id, req.params.id), eq(modules.orgId, req.authOrg!.id)))
      .returning({ id: modules.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Module not found' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/tracks/:id/reorder', async (req, reply) => {
    const body = z.object({ moduleIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'moduleIds required' });
    const db = getDb();
    const orgId = req.authOrg!.id;
    const mods = await db
      .select()
      .from(modules)
      .where(and(eq(modules.trackId, req.params.id), eq(modules.orgId, orgId)));
    const valid = new Set(mods.map((m) => m.id));
    let idx = 0;
    for (const id of body.data.moduleIds) {
      if (!valid.has(id)) continue;
      await db
        .update(modules)
        .set({ orderIndex: idx++, updatedAt: new Date() })
        .where(eq(modules.id, id));
    }
    return { ok: true };
  });

  /** Draft modules from an SOP with Claude (manager reviews/edits afterwards). */
  app.post<{ Params: { id: string } }>('/api/tracks/:id/generate', async (req, reply) => {
    const body = z
      .object({ documentId: z.string().uuid(), moduleCount: z.number().int().min(1).max(6).default(3) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'documentId required' });
    if (!anthropicAvailable()) {
      return reply.code(400).send({
        error: 'Generating modules requires ANTHROPIC_API_KEY to be configured on the server.',
      });
    }
    const db = getDb();
    const orgId = req.authOrg!.id;
    const [track] = await db
      .select()
      .from(onboardingTracks)
      .where(and(eq(onboardingTracks.id, req.params.id), eq(onboardingTracks.orgId, orgId)));
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    const [doc] = await db
      .select()
      .from(sopDocuments)
      .where(and(eq(sopDocuments.id, body.data.documentId), eq(sopDocuments.orgId, orgId)));
    if (!doc || doc.status !== 'ready') {
      return reply.code(400).send({ error: 'Document not found or not ready' });
    }
    const chunks = await db
      .select()
      .from(sopChunks)
      .where(eq(sopChunks.documentId, doc.id))
      .orderBy(asc(sopChunks.chunkIndex));
    const sopText = chunks.map((c) => `## ${c.headingPath}\n${c.content}`).join('\n\n').slice(0, 24_000);

    const raw = await generateText({
      system: fs.readFileSync(MODULES_PROMPT, 'utf8'),
      user: `Redacta ${body.data.moduleCount} módulos a partir de este SOP titulado "${doc.title}":\n\n${sopText}`,
      maxTokens: 4000,
    });
    const draftSchema = z.array(
      z.object({
        title: z.string().min(1).max(160),
        body_es: z.string().min(1).max(950),
        check_question_es: z.string().min(1).max(300),
        check_options_es: z.array(z.string().min(1)).length(3),
        check_correct_index: z.number().int().min(0).max(2),
      }),
    );
    const drafts = draftSchema.parse(extractJson(raw));

    const [maxRow] = await db
      .select({
        max: sql<number>`COALESCE(MAX(${modules.orderIndex}), -1)`,
        maxDay: sql<number>`COALESCE(MAX(${modules.dayOffset}), -1)`,
      })
      .from(modules)
      .where(eq(modules.trackId, track.id));
    let orderIndex = Number(maxRow.max) + 1;
    let dayOffset = Number(maxRow.maxDay) + 2;
    const created = [];
    for (const d of drafts) {
      const [row] = await db
        .insert(modules)
        .values({
          trackId: track.id,
          orgId,
          orderIndex: orderIndex++,
          dayOffset: dayOffset,
          sendHourLocal: 7,
          title: d.title,
          bodyEs: d.body_es.slice(0, 900),
          checkQuestionEs: d.check_question_es,
          checkOptionsEs: d.check_options_es,
          checkCorrectIndex: d.check_correct_index,
          sourceDocumentId: doc.id,
        })
        .returning();
      dayOffset += 2;
      created.push(row);
    }
    return { created };
  });

  // ── Conversations & escalations ───────────────────────────────────────────
  app.get('/api/conversations', async (req) => {
    const db = getDb();
    const orgId = req.authOrg!.id;
    const convs = await db
      .select({ conv: conversations, workerName: workers.name, workerPhone: workers.phoneE164 })
      .from(conversations)
      .innerJoin(workers, eq(conversations.workerId, workers.id))
      .where(eq(conversations.orgId, orgId))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(100);
    const ids = convs.map((c) => c.conv.id);
    const counts = ids.length
      ? await db
          .select({ conversationId: messages.conversationId, n: count() })
          .from(messages)
          .where(inArray(messages.conversationId, ids))
          .groupBy(messages.conversationId)
      : [];
    const countBy = new Map(counts.map((c) => [c.conversationId, Number(c.n)]));
    return convs.map((c) => ({
      id: c.conv.id,
      workerId: c.conv.workerId,
      workerName: c.workerName,
      workerPhone: c.workerPhone,
      lastMessageAt: c.conv.lastMessageAt,
      messageCount: countBy.get(c.conv.id) ?? 0,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (req, reply) => {
    const db = getDb();
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, req.params.id), eq(conversations.orgId, req.authOrg!.id)));
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt))
      .limit(500);
    return msgs;
  });

  app.get('/api/escalations', async (req) => {
    const db = getDb();
    const status = (req.query as { status?: string }).status;
    const conditions = [eq(escalations.orgId, req.authOrg!.id)];
    if (status === 'open' || status === 'resolved') {
      conditions.push(eq(escalations.status, status));
    }
    const rows = await db
      .select({ esc: escalations, workerName: workers.name })
      .from(escalations)
      .innerJoin(workers, eq(escalations.workerId, workers.id))
      .where(and(...conditions))
      .orderBy(desc(escalations.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.esc, workerName: r.workerName }));
  });

  app.post<{ Params: { id: string } }>('/api/escalations/:id/resolve', async (req, reply) => {
    const db = getDb();
    const [row] = await db
      .update(escalations)
      .set({ status: 'resolved', resolvedBy: req.authUser!.id, updatedAt: new Date() })
      .where(and(eq(escalations.id, req.params.id), eq(escalations.orgId, req.authOrg!.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Escalation not found' });
    return row;
  });

  // ── Audit & exports ───────────────────────────────────────────────────────
  app.get('/api/audit/exports', async (req) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(auditExports)
      .where(eq(auditExports.orgId, req.authOrg!.id))
      .orderBy(desc(auditExports.createdAt))
      .limit(50);
    return rows.map((r) => ({
      ...r,
      downloadUrl: r.status === 'ready' && r.filePath ? `/api/files/${r.filePath}` : null,
      letterUrl:
        r.status === 'ready' && r.filePath
          ? `/api/files/${r.filePath.replace(/audit-pack\.zip$/, 'training-letter.pdf')}`
          : null,
      csvUrl:
        r.status === 'ready' && r.filePath
          ? `/api/files/${r.filePath.replace(/audit-pack\.zip$/, 'training-events.csv')}`
          : null,
    }));
  });

  app.post('/api/audit/exports', async (req, reply) => {
    const body = z
      .object({
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'periodStart and periodEnd (YYYY-MM-DD) required' });
    }
    const start = new Date(`${body.data.periodStart}T00:00:00Z`);
    const end = new Date(`${body.data.periodEnd}T23:59:59.999Z`);
    if (end < start) return reply.code(400).send({ error: 'End date is before start date' });
    const db = getDb();
    const [row] = await db
      .insert(auditExports)
      .values({
        orgId: req.authOrg!.id,
        requestedBy: req.authUser!.id,
        periodStart: start,
        periodEnd: end,
        status: 'pending',
      })
      .returning();
    await dispatch('audit-export', { exportId: row.id });
    return row;
  });

  // ── Org settings ──────────────────────────────────────────────────────────
  app.patch('/api/org', async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().min(2).max(120).optional(),
        timezone: z.string().min(1).max(64).optional(),
        herdSize: z.number().int().min(1).max(1_000_000).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });
    const db = getDb();
    const [row] = await db
      .update(orgs)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(orgs.id, req.authOrg!.id))
      .returning();
    return { id: row.id, name: row.name, timezone: row.timezone, herdSize: row.herdSize };
  });

  // ── Manual drip trigger (all modes; the simulator page uses it in mock) ──
  app.post('/api/admin/run-drip', async () => {
    const result = await runDripTick(getDb());
    return result;
  });

  // ── Org-scoped file serving (certificates, audit packs, SOP sources) ─────
  app.get<{ Params: { '*': string } }>('/api/files/*', async (req, reply) => {
    const rel = req.params['*'];
    if (!rel || rel.includes('..') || !rel.startsWith(`${req.authOrg!.id}/`)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    let abs: string;
    try {
      abs = absPath(rel);
    } catch {
      return reply.code(400).send({ error: 'Bad path' });
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.code(404).send({ error: 'File not found' });
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = FILE_MIMES[ext] ?? 'application/octet-stream';
    const download = (req.query as { download?: string }).download;
    if (download !== undefined) {
      reply.header('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    }
    return reply.type(mime).send(fs.createReadStream(abs));
  });

  // ── Billing (feature-flagged) ─────────────────────────────────────────────
  app.get('/api/billing/status', async (req) => {
    const settings = (req.authOrg!.settings ?? {}) as Record<string, unknown>;
    return {
      enabled: config().enableBilling,
      billing: settings.billing ?? { active: false },
    };
  });

  app.post('/api/billing/checkout', async (req, reply) => {
    const cfg = config();
    if (!cfg.enableBilling) return reply.code(400).send({ error: 'Billing is not enabled' });
    if (!cfg.stripeSecretKey || !cfg.stripePriceBase || !cfg.stripePricePerCow) {
      return reply.code(400).send({ error: 'Stripe is not fully configured on the server' });
    }
    const org = req.authOrg!;
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('success_url', `${cfg.publicBaseUrl}/app/settings?billing=success`);
    form.set('cancel_url', `${cfg.publicBaseUrl}/app/settings?billing=cancelled`);
    form.set('line_items[0][price]', cfg.stripePriceBase);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[1][price]', cfg.stripePricePerCow);
    form.set('line_items[1][quantity]', String(org.herdSize ?? 500));
    form.set('metadata[orgId]', org.id);
    form.set('subscription_data[metadata][orgId]', org.id);
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      req.log.error({ stripe: text }, 'Stripe checkout creation failed');
      return reply.code(502).send({ error: 'Stripe checkout creation failed' });
    }
    const session = (await res.json()) as { url: string };
    return { url: session.url };
  });
}
