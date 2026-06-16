/**
 * Pre-render real Spanish lesson audio for the static GitHub Pages demo.
 *
 * A static page has no server and no API key, so the demo normally serves a
 * silent placeholder and labels voice replies as "silenced". When an
 * OPENAI_API_KEY IS available at build time, run this AFTER `pnpm seed` to
 * synthesize OGG/Opus audio for each seeded module lesson, write the files to
 * src/web/public/demo-audio/, and emit src/web/demo/audioManifest.json mapping
 * a stable key (module:<id>) → relative audio path. demoApi.ts reads that
 * manifest and plays the real file; with no key the manifest stays empty and
 * the demo behaves exactly as before.
 *
 *   OPENAI_API_KEY=sk-... pnpm tsx scripts/render-demo-audio.ts
 *
 * The production WhatsApp path is unchanged — it already synthesizes real TTS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client.js';
import { modules, onboardingTracks, users } from '../src/server/db/schema.js';
import { absPath } from '../src/server/lib/storage.js';
import { ES } from '../src/server/services/messages.es.js';
import { ttsVariant } from '../src/server/services/drip.js';
import { speechAvailable, synthesizeSpeech } from '../src/server/services/speech.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../src/web/public/demo-audio');
const MANIFEST = path.resolve(__dirname, '../src/web/demo/audioManifest.json');

function lessonText(
  m: { orderIndex: number; title: string; bodyEs: string; checkQuestionEs: string; checkOptionsEs: string[] },
  total: number,
): string {
  return [
    ES.moduleHeader(m.orderIndex + 1, total, m.title),
    '',
    m.bodyEs,
    '',
    ES.checkPrompt(m.checkQuestionEs, m.checkOptionsEs),
  ].join('\n');
}

async function main() {
  if (!speechAvailable()) {
    console.log(
      'No OPENAI_API_KEY — skipping demo audio generation. The demo will serve the\n' +
        'silent placeholder (unchanged). Set OPENAI_API_KEY and re-run to render real audio.',
    );
    return;
  }

  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.email, 'demo@establo.app'));
  if (!owner) {
    console.error('Demo org not found — run `pnpm seed` first.');
    process.exit(1);
  }
  const orgId = owner.orgId;

  const tracks = await db.select().from(onboardingTracks).where(eq(onboardingTracks.orgId, orgId));
  const mods = await db
    .select()
    .from(modules)
    .where(eq(modules.orgId, orgId))
    .orderBy(asc(modules.orderIndex));
  const totalByTrack = new Map<string, number>();
  for (const m of mods) totalByTrack.set(m.trackId, (totalByTrack.get(m.trackId) ?? 0) + 1);

  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const manifest: Record<string, string> = {};

  for (const m of mods) {
    const total = totalByTrack.get(m.trackId) ?? mods.length;
    const tts = await synthesizeSpeech(ttsVariant(lessonText(m, total)));
    if (tts.placeholder) {
      console.warn('  unexpected placeholder audio — aborting'); // key disappeared mid-run
      break;
    }
    const dest = path.join(PUBLIC_DIR, `module-${m.id}.ogg`);
    fs.copyFileSync(absPath(tts.relPath), dest);
    manifest[`module:${m.id}`] = `./demo-audio/module-${m.id}.ogg`;
    console.log(`✓ rendered lesson audio: ${m.title}`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `✓ Wrote ${MANIFEST} (${Object.keys(manifest).length} entries) and ${PUBLIC_DIR}` +
      `\n  Tracks covered: ${tracks.map((t) => t.name).join(', ')}`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
