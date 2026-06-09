import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sopChunks, sopDocuments } from '../db/schema.js';
import { config } from '../config.js';
import { embedQuery } from './embeddings.js';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  headingPath: string;
  content: string;
  similarity: number;
}

/**
 * Top-K cosine retrieval over the org's ready SOP chunks.
 * ALWAYS scoped to org_id — this is the multi-tenant boundary.
 */
export async function retrieveChunks(
  db: Db,
  orgId: string,
  query: string,
  k: number = config().retrievalTopK,
): Promise<RetrievedChunk[]> {
  const vec = JSON.stringify(await embedQuery(query));
  const distance = sql<number>`${sopChunks.embedding} <=> ${vec}::vector`;
  const rows = await db
    .select({
      id: sopChunks.id,
      documentId: sopChunks.documentId,
      documentTitle: sopDocuments.title,
      headingPath: sopChunks.headingPath,
      content: sopChunks.content,
      distance,
    })
    .from(sopChunks)
    .innerJoin(sopDocuments, eq(sopChunks.documentId, sopDocuments.id))
    .where(
      and(
        eq(sopChunks.orgId, orgId),
        eq(sopDocuments.status, 'ready'),
        isNotNull(sopChunks.embedding),
      ),
    )
    .orderBy(distance)
    .limit(k);

  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    headingPath: r.headingPath,
    content: r.content,
    similarity: 1 - Number(r.distance),
  }));
}
