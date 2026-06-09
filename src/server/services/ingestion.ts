import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sopChunks, sopDocuments, type SopDocument } from '../db/schema.js';
import { absPath } from '../lib/storage.js';
import { chunkMarkdown } from './chunker.js';
import { embedTexts } from './embeddings.js';
import { ocrImagesToMarkdown, type VisionMediaType } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OCR_PROMPT_PATH = path.resolve(__dirname, '../../../prompts/ocr.md');

const IMAGE_MIMES: Record<string, VisionMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

export function isImageMime(mime: string): boolean {
  return mime in IMAGE_MIMES;
}

function mimeFromFilename(name: string): VisionMediaType {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function extractPdf(filePath: string): Promise<{ markdown: string; pages: number }> {
  // Import the inner module directly — pdf-parse's index.js runs debug code
  // when loaded outside a CJS parent.
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  const data = await pdfParse(await fs.promises.readFile(filePath));
  return { markdown: data.text ?? '', pages: data.numpages ?? 1 };
}

async function extractDocx(filePath: string): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const buffer = await fs.promises.readFile(filePath);
  try {
    const result = await (
      mammoth as unknown as {
        convertToMarkdown: (i: { buffer: Buffer }) => Promise<{ value: string }>;
      }
    ).convertToMarkdown({ buffer });
    if (result.value.trim()) return result.value;
  } catch {
    // fall through to raw text
  }
  const raw = await mammoth.extractRawText({ buffer });
  return raw.value;
}

async function extractImages(doc: SopDocument): Promise<{ markdown: string; pages: number }> {
  // storage_path is a DIRECTORY of page files (page-001.jpg, page-002.jpg, …)
  const dir = absPath(doc.storagePath!);
  const files = (await fs.promises.readdir(dir)).filter((f) => !f.startsWith('.')).sort();
  if (files.length === 0) throw new Error('No image pages found');
  const images = await Promise.all(
    files.map(async (f) => ({
      data: await fs.promises.readFile(path.join(dir, f)),
      mediaType: mimeFromFilename(f),
    })),
  );
  const instruction = fs.readFileSync(OCR_PROMPT_PATH, 'utf8');
  const markdown = await ocrImagesToMarkdown(images, instruction);
  return { markdown, pages: files.length };
}

export async function extractDocumentMarkdown(
  doc: SopDocument,
): Promise<{ markdown: string; pages: number }> {
  const mime = doc.mimeType ?? '';
  if (mime === 'application/pdf') {
    return extractPdf(absPath(doc.storagePath!));
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) {
    const markdown = await extractDocx(absPath(doc.storagePath!));
    return { markdown, pages: 1 };
  }
  if (mime === 'establo/image-pages' || isImageMime(mime)) {
    return extractImages(doc);
  }
  if (mime.startsWith('text/')) {
    const markdown = await fs.promises.readFile(absPath(doc.storagePath!), 'utf8');
    return { markdown, pages: 1 };
  }
  throw new Error(`Unsupported file type: ${mime || 'unknown'}`);
}

/**
 * Full ingestion pipeline for one document:
 * extract → normalize markdown → heading-aware chunking → embed → ready.
 * Runs as a pg-boss job; any failure marks the document `failed` with a
 * human-readable error shown in the dashboard.
 */
export async function ingestDocument(db: Db, documentId: string): Promise<void> {
  const [doc] = await db.select().from(sopDocuments).where(eq(sopDocuments.id, documentId));
  if (!doc) throw new Error(`Document ${documentId} not found`);

  await db
    .update(sopDocuments)
    .set({ status: 'processing', errorText: null, updatedAt: new Date() })
    .where(eq(sopDocuments.id, documentId));

  try {
    const { markdown: rawMarkdown, pages } = await extractDocumentMarkdown(doc);
    let markdown = rawMarkdown.replace(/\r\n/g, '\n').trim();
    if (!markdown) throw new Error('No text could be extracted from this file');
    // Ensure a top-level heading so heading_paths start with the doc title.
    if (!/^#\s/m.test(markdown)) markdown = `# ${doc.title}\n\n${markdown}`;

    const chunks = chunkMarkdown(markdown, doc.title);
    if (chunks.length === 0) throw new Error('Document produced no content chunks');

    // Embed heading context + content together for better retrieval.
    const embeddings = await embedTexts(chunks.map((c) => `${c.headingPath}\n${c.content}`));

    await db.delete(sopChunks).where(eq(sopChunks.documentId, documentId));
    await db.insert(sopChunks).values(
      chunks.map((c, i) => ({
        orgId: doc.orgId,
        documentId: doc.id,
        chunkIndex: i,
        headingPath: c.headingPath,
        content: c.content,
        tokenCount: c.tokenCount,
        embedding: embeddings[i],
      })),
    );

    await db
      .update(sopDocuments)
      .set({ status: 'ready', pageCount: pages, errorText: null, updatedAt: new Date() })
      .where(eq(sopDocuments.id, documentId));
  } catch (err) {
    await db
      .update(sopDocuments)
      .set({
        status: 'failed',
        errorText: (err as Error).message,
        updatedAt: new Date(),
      })
      .where(eq(sopDocuments.id, documentId));
    throw err;
  }
}
