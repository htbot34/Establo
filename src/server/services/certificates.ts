import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  enrollments,
  moduleDeliveries,
  modules,
  onboardingTracks,
  orgs,
  workers,
} from '../db/schema.js';
import { formatDateEs } from '../lib/time.js';
import { saveBuffer } from '../lib/storage.js';
import { PDF_COLORS, pdfToBuffer } from './pdf.js';

export function certificateRelPath(orgId: string, enrollmentId: string): string {
  return `${orgId}/certificates/certificado-${enrollmentId}.pdf`;
}

/**
 * Spanish completion certificate for a finished onboarding track.
 * Generated once when the worker answers the final module's check.
 */
export async function generateCertificate(db: Db, enrollmentId: string): Promise<string> {
  const [enr] = await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId));
  if (!enr) throw new Error(`Enrollment ${enrollmentId} not found`);
  const [worker] = await db.select().from(workers).where(eq(workers.id, enr.workerId));
  const [track] = await db
    .select()
    .from(onboardingTracks)
    .where(eq(onboardingTracks.id, enr.trackId));
  const [org] = await db.select().from(orgs).where(eq(orgs.id, enr.orgId));
  const mods = await db.select().from(modules).where(eq(modules.trackId, enr.trackId));
  mods.sort((a, b) => a.orderIndex - b.orderIndex);
  const deliveries = await db
    .select()
    .from(moduleDeliveries)
    .where(eq(moduleDeliveries.enrollmentId, enrollmentId));
  const deliveredById = new Map(deliveries.map((d) => [d.moduleId, d]));
  const tz = org.timezone;
  const completedAt =
    deliveries
      .map((d) => d.checkAnsweredAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date();

  const buf = await pdfToBuffer({ size: 'A4', layout: 'landscape', margin: 0 }, (doc) => {
    const W = doc.page.width;
    const H = doc.page.height;
    // Double border
    doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke(PDF_COLORS.accent);
    doc.rect(32, 32, W - 64, H - 64).lineWidth(0.7).stroke(PDF_COLORS.accent);

    doc.font('Helvetica-Bold').fontSize(13).fillColor(PDF_COLORS.accent);
    doc.text('ESTABLO', 0, 58, { align: 'center', characterSpacing: 4 });
    doc.font('Helvetica').fontSize(10).fillColor(PDF_COLORS.muted);
    doc.text('Capacitación verificada por WhatsApp', { align: 'center' });

    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(30).fillColor(PDF_COLORS.ink);
    doc.text('Certificado de Capacitación', { align: 'center' });

    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.muted);
    doc.text('Se otorga el presente certificado a', { align: 'center' });

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(24).fillColor(PDF_COLORS.ink);
    doc.text(worker.name, { align: 'center' });

    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).fillColor(PDF_COLORS.ink);
    doc.text(
      `por completar el programa de capacitación "${track.name}"`,
      80,
      doc.y,
      { align: 'center', width: W - 160 },
    );
    doc.text(`en ${org.name}`, { align: 'center', width: W - 160 });

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_COLORS.accent);
    doc.text('MÓDULOS COMPLETADOS', { align: 'center', width: W - 160 });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).fillColor(PDF_COLORS.ink);
    for (const m of mods) {
      const d = deliveredById.get(m.id);
      const when = d?.sentAt ? ` — ${formatDateEs(d.sentAt, tz)}` : '';
      doc.text(`${m.orderIndex + 1}. ${m.title}${when}`, { align: 'center', width: W - 160 });
    }

    doc.font('Helvetica').fontSize(11).fillColor(PDF_COLORS.ink);
    doc.text(
      `Fecha de finalización: ${formatDateEs(completedAt, tz)}`,
      80,
      H - 110,
      { align: 'center', width: W - 160 },
    );
    doc.fontSize(8.5).fillColor(PDF_COLORS.muted);
    doc.text(
      `Registro verificable de capacitación generado por Establo · ${org.name} · Certificado ${enrollmentId.slice(0, 8).toUpperCase()}`,
      80,
      H - 78,
      { align: 'center', width: W - 160 },
    );
  });

  const rel = certificateRelPath(enr.orgId, enrollmentId);
  await saveBuffer(rel, buf);
  return rel;
}
