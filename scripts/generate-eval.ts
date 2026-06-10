/**
 * Generate the full eval set (120 Spanish Q&A pairs: 90 answerable with
 * expected source doc, 30 deliberately unanswerable) from the seeded SOPs.
 * Requires ANTHROPIC_API_KEY. Output: evals/establo-eval-v1.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client.js';
import { sopChunks, sopDocuments, users } from '../src/server/db/schema.js';
import { anthropicAvailable, extractJson, generateText } from '../src/server/services/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.resolve(__dirname, '../prompts/eval-generate.md'), 'utf8');
const OUT = path.resolve(__dirname, '../evals/establo-eval-v1.jsonl');

interface EvalCase {
  id: string;
  question: string;
  answerable: boolean;
  expected_doc: string | null;
  expected_facts: string | null;
}

async function main() {
  if (!anthropicAvailable()) {
    console.error(
      'generate-eval requires ANTHROPIC_API_KEY.\n' +
        'Without it, `pnpm eval` still runs against the committed starter set ' +
        '(evals/establo-eval-starter.jsonl).',
    );
    process.exit(1);
  }
  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.email, 'demo@establo.app'));
  if (!owner) {
    console.error('Demo org not found — run `pnpm seed` first.');
    process.exit(1);
  }
  const docs = await db
    .select()
    .from(sopDocuments)
    .where(eq(sopDocuments.orgId, owner.orgId))
    .orderBy(asc(sopDocuments.createdAt));
  const ready = docs.filter((d) => d.status === 'ready');
  if (ready.length === 0) {
    console.error('No ready SOP documents in the demo org.');
    process.exit(1);
  }

  const cases: EvalCase[] = [];
  const perDoc = Math.ceil(90 / ready.length);

  for (const doc of ready) {
    const chunks = await db
      .select()
      .from(sopChunks)
      .where(eq(sopChunks.documentId, doc.id))
      .orderBy(asc(sopChunks.chunkIndex));
    const text = chunks.map((c) => `### ${c.headingPath}\n${c.content}`).join('\n\n');
    console.log(`Generating ${perDoc} answerable questions from "${doc.title}"…`);
    const raw = await generateText({
      system: PROMPT,
      user:
        `Generate exactly ${perDoc} ANSWERABLE eval cases from this single SOP.\n` +
        `Document title (use EXACTLY this as expected_doc): "${doc.title}"\n\n${text.slice(0, 30_000)}`,
      maxTokens: 6000,
      temperature: 0.6,
    });
    const items = extractJson<Array<Omit<EvalCase, 'id'>>>(raw);
    for (const item of items.slice(0, perDoc)) {
      cases.push({ id: `a${String(cases.length + 1).padStart(3, '0')}`, ...item, answerable: true, expected_doc: doc.title });
    }
  }
  const answerable = cases.length;

  console.log('Generating 30 unanswerable / out-of-scope questions…');
  const covered = ready.map((d) => d.title).join('; ');
  const rawU = await generateText({
    system: PROMPT,
    user:
      `Generate exactly 30 UNANSWERABLE eval cases. The dairy's SOPs cover ONLY these topics: ${covered}. ` +
      `Questions must sound like real dairy workers but must NOT be answerable from those documents ` +
      `(e.g. equipment repair details, HR/salary, immigration, vet dosing, feed rations, topics not covered).`,
    maxTokens: 4000,
    temperature: 0.7,
  });
  const itemsU = extractJson<Array<Omit<EvalCase, 'id'>>>(rawU);
  for (const item of itemsU.slice(0, 30)) {
    cases.push({
      id: `u${String(cases.length + 1).padStart(3, '0')}`,
      question: item.question,
      answerable: false,
      expected_doc: null,
      expected_facts: null,
    });
  }

  fs.writeFileSync(OUT, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`\n✓ Wrote ${cases.length} cases (${answerable} answerable, ${cases.length - answerable} unanswerable)`);
  console.log(`  → ${OUT}\n  Run them: pnpm eval`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
