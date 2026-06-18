import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agreementSignatures,
  auditExports,
  enrollments,
  onboardingTracks,
  orgs,
  sopDocuments,
  trainingEvents,
  workers,
  type AgreementSignature,
  type FarmTopic,
  type TrainingEvent,
  type Worker,
} from '../db/schema.js';
import { toCsv } from '../lib/csv.js';
import { formatDateEn, formatDateTimeEn } from '../lib/time.js';
import { absPath, ensureDir, saveBuffer } from '../lib/storage.js';
import { renewalDue } from './agreements.js';
import { FARM_CE_AREAS, FARM_TOPIC_LABELS, expectedCeAreasForRole } from './farmTopics.js';
import { PDF_COLORS, drawTableRow, pdfToBuffer } from './pdf.js';
import { generateWorkerTranscriptPdf } from './transcripts.js';

interface FarmAreaSummary {
  events: number;
  qaCount: number;
  modulesDelivered: number;
  checksPassed: number;
  checksTotal: number;
  first: Date | null;
  last: Date | null;
}

interface SignOffInfo {
  trackName: string;
  completed: boolean;
  signedOffAt: Date | null;
  signedOffName: string | null;
  signedOffRole: string | null;
}

interface WorkerSummary {
  worker: Worker;
  qaCount: number;
  modulesDelivered: number;
  checksPassed: number;
  checksTotal: number;
  topics: Set<string>;
  firstActivity: Date | null;
  lastActivity: Date | null;
  byFarmArea: Map<FarmTopic, FarmAreaSummary>;
  /** FARM CE areas with zero documented events in the window. */
  gaps: FarmTopic[];
  agreement: AgreementSignature | null;
  signOffs: SignOffInfo[];
}

function emptyArea(): FarmAreaSummary {
  return { events: 0, qaCount: 0, modulesDelivered: 0, checksPassed: 0, checksTotal: 0, first: null, last: null };
}

function summarize(
  workerRows: Worker[],
  events: TrainingEvent[],
  agreementByWorker: Map<string, AgreementSignature>,
  signOffsByWorker: Map<string, SignOffInfo[]>,
): WorkerSummary[] {
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
      byFarmArea: new Map(),
      gaps: [],
      agreement: agreementByWorker.get(w.id) ?? null,
      signOffs: signOffsByWorker.get(w.id) ?? [],
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

    const farmTopic = (ev.farmTopic ?? 'none') as FarmTopic;
    if (farmTopic !== 'none') {
      const area = s.byFarmArea.get(farmTopic) ?? emptyArea();
      area.events++;
      if (ev.eventType === 'qa_interaction') area.qaCount++;
      if (ev.eventType === 'module_delivered') area.modulesDelivered++;
      if (ev.eventType === 'check_passed') {
        area.checksPassed++;
        area.checksTotal++;
      }
      if (ev.eventType === 'check_failed') area.checksTotal++;
      if (!area.first || ev.occurredAt < area.first) area.first = ev.occurredAt;
      if (!area.last || ev.occurredAt > area.last) area.last = ev.occurredAt;
      s.byFarmArea.set(farmTopic, area);
    }
  }
  for (const s of byWorker.values()) {
    s.gaps = expectedCeAreasForRole(s.worker.jobRole).filter((a) => !s.byFarmArea.has(a));
  }
  // Workers appear if they have activity OR compliance records worth showing.
  return [...byWorker.values()].filter(
    (s) => s.firstActivity !== null || s.agreement !== null || s.signOffs.length > 0,
  );
}

const CONSENT_LABELS: Record<string, string> = {
  opted_in: 'Opted in',
  opted_out: 'OPTED OUT',
  pending: 'Awaiting opt-in',
};

function consentLine(w: Worker, tz: string): string {
  const label = CONSENT_LABELS[w.consentStatus] ?? w.consentStatus;
  const when = w.consentedAt ? ` on ${formatDateEn(w.consentedAt, tz)}` : '';
  const method = w.consentMethod ? ` (${w.consentMethod.replace(/_/g, ' ')})` : '';
  return `${label}${when}${method}`;
}

function agreementLine(sig: AgreementSignature | null, tz: string): string {
  if (!sig) return 'Not signed';
  const renew = renewalDue(sig.signedAt) ? ' — ANNUAL RENEWAL DUE' : '';
  return `Signed v${sig.agreementVersion} on ${formatDateEn(sig.signedAt, tz)} via ${sig.method}${renew}`;
}

/**
 * Training-documentation letter positioned for FARM Animal Care Version 5
 * continuing-education expectations: per-employee records in general animal
 * care/handling plus the four job-specific areas, signed cow care agreements,
 * and supervisor sign-offs. Documentation only — it never claims FARM
 * certification or evaluator approval.
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
    doc.text('Employee Training & Continuing Education Documentation');
    doc.moveDown(0.6);

    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    doc.text('To whom it may concern:', { lineGap: 2 });
    doc.moveDown(0.4);
    doc.text(
      `This letter documents employee training and continuing education records for ${org.name}` +
        `${org.herdSize ? ` (approx. ${org.herdSize.toLocaleString()} cows)` : ''} for the period ` +
        `${formatDateEn(period.start, tz)} through ${formatDateEn(period.end, tz)}. Records are ` +
        `organized by the FARM Animal Care Program, Version 5 continuing-education areas relevant to ` +
        `each employee's role — drawn from general animal care and handling (stockmanship), plus the ` +
        `job-specific areas of pre-weaned calf care, non-ambulatory animal management, euthanasia, and ` +
        `fitness to transport. Per-employee cow care agreement signatures and supervisor sign-offs on ` +
        `completed onboarding tracks are included.`,
      { lineGap: 2 },
    );
    doc.moveDown(0.4);
    doc.text(
      `Establo delivers structured lessons with comprehension checks and answers employee questions ` +
        `in Spanish over WhatsApp, grounded exclusively in this operation's own written procedures; ` +
        `every interaction is logged at the moment it occurs. During this period, ${summaries.length} ` +
        `employee(s) generated ${totalEvents} logged training events. These are training records ` +
        `maintained to support your FARM Animal Care evaluation; this letter does not constitute ` +
        `FARM program certification, enrollment, or evaluator approval. Full per-employee ` +
        `transcripts and a machine-readable export (CSV) accompany this letter.`,
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

    // ── Per-employee FARM Animal Care v5 continuing-education detail ─────────
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(PDF_COLORS.ink);
    doc.text('Continuing education by FARM Animal Care v5 area — per employee');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted);
    doc.text(
      'Each employee is shown against the FARM v5 continuing-education areas relevant to their job ' +
        'role. Areas with no documented activity in this period are flagged so coverage gaps are ' +
        'visible before an evaluation.',
      { lineGap: 2 },
    );
    doc.moveDown(0.8);

    for (const s of summaries) {
      if (doc.y > doc.page.height - 220) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(PDF_COLORS.accent);
      doc.text(s.worker.name);
      doc.moveDown(0.15);

      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.ink);
      doc.text(`Messaging consent: ${consentLine(s.worker, tz)}`, { indent: 10 });
      doc.text(`Cow care agreement: ${agreementLine(s.agreement, tz)}`, { indent: 10 });
      if (s.signOffs.length === 0) {
        doc.text('Onboarding sign-off: no completed onboarding tracks in record', { indent: 10 });
      } else {
        for (const so of s.signOffs) {
          const line = so.signedOffAt
            ? `Onboarding sign-off: "${so.trackName}" — completion confirmed by ${so.signedOffName ?? 'manager'} ` +
              `(${so.signedOffRole ?? 'manager'}) on ${formatDateEn(so.signedOffAt, tz)}`
            : `Onboarding sign-off: "${so.trackName}" — completed, NOT YET CONFIRMED by a supervisor`;
          doc.text(line, { indent: 10 });
        }
      }
      doc.moveDown(0.25);

      const expected = expectedCeAreasForRole(s.worker.jobRole);
      for (const area of FARM_CE_AREAS) {
        const a = s.byFarmArea.get(area);
        if (a) {
          doc.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.ink);
          const checks = a.checksTotal > 0 ? `, checks ${a.checksPassed}/${a.checksTotal} passed` : '';
          const range =
            a.first && a.last
              ? a.first.getTime() === a.last.getTime()
                ? formatDateEn(a.first, tz)
                : `${formatDateEn(a.first, tz)} – ${formatDateEn(a.last, tz)}`
              : '';
          doc.text(
            `• ${FARM_TOPIC_LABELS[area]}: ${a.events} event(s) — ` +
              `${a.modulesDelivered} lesson(s)${checks}, ${a.qaCount} Q&A — ${range}`,
            { indent: 10 },
          );
        } else if (expected.includes(area)) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#b45309');
          doc.text(`• No documented continuing education in: ${FARM_TOPIC_LABELS[area]}`, {
            indent: 10,
          });
        }
      }
      doc.moveDown(0.7);
    }

    doc.moveDown(1);
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.ink);
    doc.text(
      'Training types: "Q&A" are employee-initiated questions answered from this operation\'s SOPs ' +
        'with source citations; "Modules" are scheduled structured lessons; "Checks" are one-question ' +
        'comprehension verifications following each module, with supervisor sign-off recorded on ' +
        'completed onboarding tracks.',
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

function signOffCsvCell(signOffs: SignOffInfo[]): string {
  if (signOffs.length === 0) return '';
  return signOffs
    .map((so) =>
      so.signedOffAt
        ? `${so.trackName}: confirmed by ${so.signedOffName ?? ''} (${so.signedOffRole ?? ''}) ${so.signedOffAt.toISOString().slice(0, 10)}`
        : `${so.trackName}: completed, unconfirmed`,
    )
    .join('; ');
}

function agreementCsvCell(sig: AgreementSignature | null): string {
  if (!sig) return 'unsigned';
  const renew = renewalDue(sig.signedAt) ? ' (renewal due)' : '';
  return `signed v${sig.agreementVersion} ${sig.signedAt.toISOString().slice(0, 10)} via ${sig.method}${renew}`;
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

    // Latest cow care agreement signature per worker.
    const sigs = await db
      .select()
      .from(agreementSignatures)
      .where(eq(agreementSignatures.orgId, job.orgId))
      .orderBy(desc(agreementSignatures.signedAt));
    const agreementByWorker = new Map<string, AgreementSignature>();
    for (const sig of sigs) {
      if (!agreementByWorker.has(sig.workerId)) agreementByWorker.set(sig.workerId, sig);
    }

    // Completed enrollments + supervisor sign-off state.
    const enrRows = await db
      .select({ enr: enrollments, trackName: onboardingTracks.name })
      .from(enrollments)
      .innerJoin(onboardingTracks, eq(enrollments.trackId, onboardingTracks.id))
      .where(and(eq(enrollments.orgId, job.orgId), eq(enrollments.status, 'completed')));
    const signOffsByWorker = new Map<string, SignOffInfo[]>();
    for (const { enr, trackName } of enrRows) {
      const list = signOffsByWorker.get(enr.workerId) ?? [];
      list.push({
        trackName,
        completed: true,
        signedOffAt: enr.signedOffAt,
        signedOffName: enr.signedOffName,
        signedOffRole: enr.signedOffRole,
      });
      signOffsByWorker.set(enr.workerId, list);
    }

    const summaries = summarize(workerRows, events, agreementByWorker, signOffsByWorker);
    const period = { start: job.periodStart, end: job.periodEnd };

    const dir = `${job.orgId}/audit/${exportId}`;
    await ensureDir(dir);

    // 1. Letter
    const letter = await buildLetterPdf(org, period, summaries, events.length);
    await saveBuffer(`${dir}/training-letter.pdf`, letter);

    // 2. CSV of every training event (+ per-worker compliance columns)
    const csv = toCsv(
      [
        'event_id', 'occurred_at_utc', 'employee', 'phone', 'event_type', 'topic', 'farm_topic',
        'confidence', 'question', 'answer', 'source_document',
        'consent_status', 'consent_date_utc', 'cow_care_agreement', 'supervisor_sign_off',
      ],
      events.map((ev) => {
        const w = workerById.get(ev.workerId);
        return [
          ev.id,
          ev.occurredAt.toISOString(),
          w?.name ?? ev.workerId,
          w?.phoneE164 ?? '',
          ev.eventType,
          ev.topic,
          ev.farmTopic ?? 'none',
          ev.confidence ?? '',
          ev.questionText ?? '',
          ev.answerText ?? '',
          ev.sourceDocumentId ? (docTitle.get(ev.sourceDocumentId) ?? '') : '',
          w?.consentStatus ?? '',
          w?.consentedAt ? w.consentedAt.toISOString() : '',
          agreementCsvCell(w ? (agreementByWorker.get(w.id) ?? null) : null),
          signOffCsvCell(w ? (signOffsByWorker.get(w.id) ?? []) : []),
        ];
      }),
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
