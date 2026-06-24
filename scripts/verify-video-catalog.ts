/**
 * Verify the curated training-video catalog (src/server/services/videoCatalog.ts):
 * every entry must have a non-empty attribution credit and a valid embeddable
 * YouTube/Vimeo link (plus a valid English reference link when present).
 *
 *   pnpm verify-video-catalog
 *
 * Exits non-zero (and prints each problem) if anything fails, so it can gate a
 * later addition to the catalog. Kept out of test:unit on purpose — it is a
 * standalone data check a manager/CI can run.
 */
import { VIDEO_CATALOG, verifyCatalog } from '../src/server/services/videoCatalog.js';

const { ok, problems } = verifyCatalog();

if (ok) {
  console.log(`✓ Video catalog OK — ${VIDEO_CATALOG.length} entries, each with attribution + an embeddable link.`);
  process.exit(0);
}

console.error(`✗ Video catalog has ${problems.length} problem(s):`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
