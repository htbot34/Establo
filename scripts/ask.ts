/**
 * CLI smoke test for the retrieval + answer pipeline:
 *   pnpm ask "¿cuánto tiempo dejo el pre-dip?"
 * Uses the seeded demo org unless --org <id> is passed.
 */
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client.js';
import { users } from '../src/server/db/schema.js';
import { answerQuestion } from '../src/server/services/answer.js';
import { retrieveChunks } from '../src/server/services/retrieval.js';
import { retrievalMinSimilarity, usingStubEmbeddings } from '../src/server/services/embeddings.js';

async function main() {
  const args = process.argv.slice(2);
  let orgId: string | undefined;
  const orgFlag = args.indexOf('--org');
  if (orgFlag !== -1) {
    orgId = args[orgFlag + 1];
    args.splice(orgFlag, 2);
  }
  const question = args.join(' ').trim();
  if (!question) {
    console.error('Usage: pnpm ask "¿cuánto tiempo dejo el pre-dip?" [--org <orgId>]');
    process.exit(1);
  }

  const db = getDb();
  if (!orgId) {
    const [owner] = await db.select().from(users).where(eq(users.email, 'demo@establo.app'));
    if (!owner) {
      console.error('Demo org not found — run `pnpm seed` first, or pass --org <orgId>.');
      process.exit(1);
    }
    orgId = owner.orgId;
  }

  console.log(`\n❓ ${question}`);
  console.log(
    `   (embeddings: ${usingStubEmbeddings() ? 'STUB hash-based' : 'OpenAI'}, floor: ${retrievalMinSimilarity()})\n`,
  );

  const chunks = await retrieveChunks(db, orgId, question);
  console.log('── Retrieved chunks ──────────────────────────────────────────');
  for (const c of chunks) {
    console.log(
      `  ${c.similarity.toFixed(3)}  ${c.documentTitle} — ${c.headingPath}  (${c.content.length} chars)`,
    );
  }

  const result = await answerQuestion(db, orgId, question);
  console.log('\n── Answer ────────────────────────────────────────────────────');
  console.log(result.text);
  console.log('\n── Meta ──────────────────────────────────────────────────────');
  console.log(
    `  confidence=${result.confidence}  topic=${result.topic}  stub=${result.usedStub}  bestSim=${result.bestSimilarity?.toFixed(3) ?? 'n/a'}`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
