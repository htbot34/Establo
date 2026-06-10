import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  auditExports,
  orgs,
  sopDocuments,
  trainingEvents,
  workers,
  type TrainingEvent,
  type Worker,
} from '../db/schema.js';
import { toCsv } from '../lib/csv.js';
import { formatDateEn, formatDateTimeEn } from '../lib/time.js';
import { absPath, ensureDir, saveBuffer } from '../lib/storage.js';
import { PDF_COLORS, drawTableRow, pdfToBuffer } from './pdf.js';
import { generateWorkerTranscriptPdf } from './transcripts.js';

interface WorkerSummary {
  worker: Worker;
  qaCount: number;
  modulesDelivered: number;
  checksPassed: number;
  checksTotal: number;
  topics: Set<string>;
  firstActivity: Date | null;
  lastActivity: Date | null;
}

function summarize(workerRows: Worker[], events: TrainingEvent[]): WorkerSummary[] {
  const byWorker = new Map<string, WorkerSummary>();
  for (const w of workerRows) {
    byWorker.set(w.id, {
      worker: w,
      qaCount: 0,
      modulesDelivered: 0,
      checksPassed: 0,
      checksTotal: 0,
      topics: new Set(),
      firstActivity: null,
      lastActivity: null,
    });
  }
  for (const ev of events) {
    const s = byWorker.get(ev.workerId);
    if (!s) continue;
    if (ev.eventType === 'qa_interaction') s.qaCount++;
    if (ev.eventType === 'module_delivered') s.modulesDelivered++;
    if (ev.eventType === 'check_passed') {
      s.checksPassed++;
      s.checksTotal++;
    }
    if (ev.eventType === 'check_failed') s.checksTotal++;
    if (ev.topic && ev.topic !== 'Otro') s.topics.add(ev.topic);
    if (!s.firstActivity || ev.occurredAt < s.firstActivity) s.firstActivity = ev.occurredAt;
    if (!s.lastActivity || ev.occurredAt > s.lastActivity) s.lastActivity = ev.occurredAt;
  }
  return [...byWorker.values()].filter((s) => s.firstActivity !== null);
}

/**
 * FARM-style training documentation letter (modeled on the NMSU Extension
 * training-letter convention: which employees were trained, when, on what
 * topics, and how it was verified).
 */
async function buildLetterPdf(
  org: { name: string; timezone: string; herdSize: number | null },
  period: { start: Date; end: Date },
  summaries: WorkerSummary[],
  totalEvents: number,
): Promise<Buffer> {
  const tz = org.timezone;
  return pdfToBuffer({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } }, (doc) => {
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Letterhead
    doc.font('Helvetica-Bold').fontSize(15).fillColor(PDF_COLORS.accent);
    doc.text('ESTABLO', { characterSpacing: 4 });
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.muted);
    doc.text('WhatsApp-based workforce training & SOP assistance · Verified interaction records');
    doc.moveDown(0.4);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(1.2)
      .stroke(PDF_COLORS.accent);
    doc.moveDown(1);

    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    doc.text(formatDateEn(new Date(), tz));
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(13);
    doc.text('Employee Training Documentation Letter');
    doc.moveDown(0.6);

    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    doc.text('To whom it may concern:', { lineGap: 2 });
    doc.moveDown(0.4);
    doc.text(
      `This letter documents that the following employees of ${org.name}` +
        `${org.herdSize ? ` (approx. ${org.herdSize.toLocaleString()} cows)` : ''} received ` +
        `workforce training and standard-operating-procedure (SOP) assistance through Establo ` +
        `during the period ${formatDateEn(period.start, tz)} through ${formatDateEn(period.end, tz)}. ` +
        `Establo delivers structured onboarding modules with comprehension checks and answers ` +
        `employee questions in Spanish over WhatsApp, grounded exclusively in this operation's own ` +
        `written procedures. Every interaction is logged at the moment it occurs.`,
      { lineGap: 2 },
    );
    doc.moveDown(0.4);
    doc.text(
      `During this period, ${summaries.length} employee(s) generated ${totalEvents} logged training ` +
        `events. This documentation supports FARM Program Workforce Development evaluation criteria ` +
        `for documented, ongoing employee training. Full per-employee transcripts and a complete ` +
        `machine-readable export (CSV) accompany this letter.`,
      { lineGap: 2 },
    );
    doc.moveDown(1);

    // Summary table
    const widths = [
      contentWidth * 0.24,
      contentWidth * 0.08,
      contentWidth * 0.1,
      contentWidth * 0.1,
      contentWidth * 0.3,
      contentWidth * 0.18,
    ];
    let y = doc.y;
    y = drawTableRow(
      doc,
      y,
      ['Employee', 'Q&A', 'Modules', 'Checks', 'Topics covered', 'Activity period'],
      widths,
      { bold: true },
    );
    doc
      .moveTo(doc.page.margins.left, y - 3)
      .lineTo(doc.page.width - doc.page.margins.right, y - 3)
      .lineWidth(0.7)
      .stroke(PDF_COLORS.line);

    for (const s of summaries) {
      if (y > doc.page.height - 110) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      y = drawTableRow(
        doc,
        y,
        [
          s.worker.name,
          String(s.qaCount),
          String(s.modulesDelivered),
          s.checksTotal > 0 ? `${s.checksPassed}/${s.checksTotal}` : '—',
          [...s.topics].join(', ') || '—',
          s.firstActivity && s.lastActivity
            ? `${formatDateEn(s.firstActivity, tz)} – ${formatDateEn(s.lastActivity, tz)}`
            : '—',
        ],
        widths,
      );
    }

    doc.moveDown(2);
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    doc.text(
      'Training types: "Q&A" are employee-initiated questions answered from this operation\'s SOPs ' +
        'with source citations; "Modules" are scheduled structured lessons; "Checks" are one-question ' +
        'comprehension verifications following each module.',
      { lineGap: 2 },
    );
    doc.moveDown(1.5);
    doc.text('Sincerely,');
    doc.moveDown(2);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + 200, doc.y)
      .stroke(PDF_COLORS.ink);
    doc.moveDown(0.2);
    doc.fontSize(9).text(`${org.name} — Authorized representative`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(PDF_COLORS.muted);
    doc.text(
      `Generated by Establo on ${formatDateTimeEn(new Date(), tz)} from the immutable training_events ` +
        `log. Record counts can be independently verified against the accompanying CSV export.`,
    );
  });
}

/** pg-boss job: build the full audit pack (letter PDF + CSV + transcripts zip). */
export async function runAuditExport(db: Db, exportId: string): Promise<void> {
  const [job] = await db.select().from(auditExports).where(eq(auditExports.id, exportId));
  if (!job) throw new Error('Audit export not found');
  await db
    .update(auditExports)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(auditExports.id, exportId));

  try {
    const [org] = await db.select().from(orgs).where(eq(orgs.id, job.orgId));
    const workerRows = await db.select().from(workers).where(eq(workers.orgId, job.orgId));
    const events = await db
      .select()
      .from(trainingEvents)
      .where(
        and(
          eq(trainingEvents.orgId, job.orgId),
          gte(trainingEvents.occurredAt, job.periodStart),
          lte(trainingEvents.occurredAt, job.periodEnd),
        ),
      )
      .orderBy(asc(trainingEvents.occurredAt));
    const docs = await db.select().from(sopDocuments).where(eq(sopDocuments.orgId, job.orgId));
    const docTitle = new Map(docs.map((d) => [d.id, d.title]));
    const workerById = new Map(workerRows.map((w) => [w.id, w]));

    const summaries = summarize(workerRows, events);
    const period = { start: job.periodStart, end: job.periodEnd };

    const dir = `${job.orgId}/audit/${exportId}`;
    await ensureDir(dir);

    // 1. Letter
    const letter = await buildLetterPdf(org, period, summaries, events.length);
    await saveBuffer(`${dir}/training-letter.pdf`, letter);

    // 2. CSV of every training event
    const csv = toCsv(
      [
        'event_id', 'occurred_at_utc', 'employee', 'phone', 'event_type', 'topic',
        'confidence', 'question', 'answer', 'source_document',
      ],
      events.map((ev) => [
        ev.id,
        ev.occurredAt.toISOString(),
        workerById.get(ev.workerId)?.name ?? ev.workerId,
        workerById.get(ev.workerId)?.phoneE164 ?? '',
        ev.eventType,
        ev.topic,
        ev.confidence ?? '',
        ev.questionText ?? '',
        ev.answerText ?? '',
        ev.sourceDocumentId ? (docTitle.get(ev.sourceDocumentId) ?? '') : '',
      ]),
    );
    await saveBuffer(`${dir}/training-events.csv`, Buffer.from(csv, 'utf8'));

    // 3. Per-worker transcripts
    const transcriptFiles: Array<{ name: string; buffer: Buffer }> = [];
    for (const s of summaries) {
      const buffer = await generateWorkerTranscriptPdf(db, s.worker.id, period);
      const safe = s.worker.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-');
      transcriptFiles.push({ name: `transcripts/${safe}.pdf`, buffer });
    }

    // 4. Zip everything
    const zipRel = `${dir}/audit-pack.zip`;
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(absPath(zipRel));
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(letter, { name: 'training-letter.pdf' });
      archive.append(Buffer.from(csv, 'utf8'), { name: 'training-events.csv' });
      for (const t of transcriptFiles) archive.append(t.buffer, { name: t.name });
      archive.finalize().catch(reject);
    });

    await db
      .update(auditExports)
      .set({ status: 'ready', filePath: zipRel, updatedAt: new Date() })
      .where(eq(auditExports.id, exportId));
  } catch (err) {
    await db
      .update(auditExports)
      .set({ status: 'failed', errorText: (err as Error).message, updatedAt: new Date() })
      .where(eq(auditExports.id, exportId));
    throw err;
  }
}

export function auditLetterPath(orgId: string, exportId: string): string {
  return path.posix.join(orgId, 'audit', exportId, 'training-letter.pdf');
}
export function auditCsvPath(orgId: string, exportId: string): string {
  return path.posix.join(orgId, 'audit', exportId, 'training-events.csv');
}
