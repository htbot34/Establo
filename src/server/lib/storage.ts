import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Local-filesystem storage rooted at DATA_DIR. Layout:
 *   {orgId}/sops/{documentId}/...      uploaded SOP source files
 *   {orgId}/certificates/...           completion certificates (PDF)
 *   {orgId}/audit/{exportId}/...       audit packs
 *   public-media/{uuid}.{ogg|mp3}      outbound voice notes (public —
 *                                      Twilio must be able to fetch them;
 *                                      the uuid filename is the secret)
 */

export function storageRoot(): string {
  return path.resolve(config().dataDir);
}

function safeJoin(...parts: string[]): string {
  const joined = path.resolve(storageRoot(), ...parts);
  if (!joined.startsWith(storageRoot() + path.sep) && joined !== storageRoot()) {
    throw new Error('Path escapes storage root');
  }
  return joined;
}

export function absPath(relPath: string): string {
  return safeJoin(relPath);
}

export async function saveBuffer(relPath: string, buf: Buffer): Promise<string> {
  const abs = safeJoin(relPath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf);
  return abs;
}

export async function ensureDir(relPath: string): Promise<string> {
  const abs = safeJoin(relPath);
  await fs.promises.mkdir(abs, { recursive: true });
  return abs;
}

export function fileExists(relPath: string): boolean {
  try {
    return fs.statSync(safeJoin(relPath)).isFile();
  } catch {
    return false;
  }
}

export function readStream(relPath: string): fs.ReadStream {
  return fs.createReadStream(safeJoin(relPath));
}

export async function listFiles(relDir: string): Promise<string[]> {
  const abs = safeJoin(relDir);
  try {
    return await fs.promises.readdir(abs);
  } catch {
    return [];
  }
}

export const PUBLIC_MEDIA_DIR = 'public-media';
