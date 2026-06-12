/**
 * Export the seeded demo org from Postgres into a JSON fixture consumed by
 * the static GitHub Pages demo (src/web/demo/fixture.json). Run after
 * `pnpm seed`:  pnpm tsx scripts/export-demo-fixture.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client.js';
import {
  agreements,
  agreementSignatures,
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
  users,
  workers,
} from '../src/server/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/web/demo/fixture.json');

async function main() {
  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.email, 'demo@establo.app'));
  if (!owner) {
    console.error('Demo org not found — run `pnpm seed` first.');
    process.exit(1);
  }
  const orgId = owner.orgId;
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));

  const fixture = {
    generatedAt: new Date().toISOString(),
    org: { id: org.id, name: org.name, timezone: org.timezone, herdSize: org.herdSize, locale: org.locale },
    user: { id: owner.id, email: owner.email, name: owner.name, role: owner.role },
    workers: await db.select().from(workers).where(eq(workers.orgId, orgId)).orderBy(asc(workers.name)),
    documents: await db
      .select({
        id: sopDocuments.id,
        title: sopDocuments.title,
        originalFilename: sopDocuments.originalFilename,
        mimeType: sopDocuments.mimeType,
        status: sopDocuments.status,
        pageCount: sopDocuments.pageCount,
        errorText: sopDocuments.errorText,
        createdAt: sopDocuments.createdAt,
      })
      .from(sopDocuments)
      .where(eq(sopDocuments.orgId, orgId)),
    chunks: await db
      .select({
        id: sopChunks.id,
        documentId: sopChunks.documentId,
        chunkIndex: sopChunks.chunkIndex,
        headingPath: sopChunks.headingPath,
        content: sopChunks.content,
        tokenCount: sopChunks.tokenCount,
      })
      .from(sopChunks)
      .where(eq(sopChunks.orgId, orgId))
      .orderBy(asc(sopChunks.chunkIndex)),
    tracks: await db.select().from(onboardingTracks).where(eq(onboardingTracks.orgId, orgId)),
    modules: await db.select().from(modules).where(eq(modules.orgId, orgId)).orderBy(asc(modules.orderIndex)),
    enrollments: await db.select().from(enrollments).where(eq(enrollments.orgId, orgId)),
    deliveries: await db.select().from(moduleDeliveries).where(eq(moduleDeliveries.orgId, orgId)),
    events: await db
      .select()
      .from(trainingEvents)
      .where(eq(trainingEvents.orgId, orgId))
      .orderBy(asc(trainingEvents.occurredAt)),
    conversations: await db.select().from(conversations).where(eq(conversations.orgId, orgId)),
    messages: await db
      .select()
      .from(messages)
      .where(eq(messages.orgId, orgId))
      .orderBy(asc(messages.createdAt)),
    escalations: await db.select().from(escalations).where(eq(escalations.orgId, orgId)),
    agreements: await db.select().from(agreements).where(eq(agreements.orgId, orgId)),
    signatures: await db
      .select()
      .from(agreementSignatures)
      .where(eq(agreementSignatures.orgId, orgId)),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fixture));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(
    `✓ Wrote ${OUT} (${kb} KB): ${fixture.workers.length} workers, ${fixture.chunks.length} chunks, ${fixture.events.length} events`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
