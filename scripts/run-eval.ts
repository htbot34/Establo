/**
 * Run the eval set through the FULL retrieval+generation pipeline and grade.
 *   pnpm eval
 * With ANTHROPIC_API_KEY: Claude grades each answer (LLM-as-judge).
 * Without: a deterministic heuristic grader keeps the harness runnable keyless.
 * Output: console scorecard + evals/results-{date}.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client.js';
import { sopDocuments, users } from '../src/server/db/schema.js';
import { answerQuestion } from '../src/server/services/answer.js';
import { usingStubEmbeddings } from '../src/server/services/embeddings.js';
import { anthropicAvailable, extractJson, generateText } from '../src/server/services/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRADER_PROMPT = fs.readFileSync(path.resolve(__dirname, '../prompts/eval-grade.md'), 'utf8');
const V1 = path.resolve(__dirname, '../evals/establo-eval-v1.jsonl');
const STARTER = path.resolve(__dirname, '../evals/establo-eval-starter.jsonl');

interface EvalCase {
  id: string;
  question: string;
  answerable: boolean;
  expected_doc: string | null;
  expected_facts: string | null;
}

type Verdict = 'correct' | 'incorrect' | 'wrongly_refused' | 'correct_refusal' | 'should_have_refused';

interface CaseResult {
  id: string;
  question: string;
  answerable: boolean;
  expected_doc: string | null;
  verdict: Verdict;
  citation_ok: boolean;
  fabricated_citation: boolean;
  confidence: string;
  cited_doc: string | null;
  answer_text: string;
  note?: string;
}

function citedDocOf(answer: string): string | null {
  const m = /📄 Fuente:\s*(.+?)\s+—/.exec(answer);
  return m ? m[1].trim() : null;
}

function heuristicGrade(
  c: EvalCase,
  answer: { text: string; confidence: string },
  citedDoc: string | null,
): { verdict: Verdict; citation_ok: boolean; note: string } {
  const refused = answer.confidence === 'not_found';
  if (c.answerable) {
    if (refused) return { verdict: 'wrongly_refused', citation_ok: !citedDoc, note: 'heuristic' };
    const citationOk = citedDoc === c.expected_doc;
    return {
      verdict: citationOk ? 'correct' : 'incorrect',
      citation_ok: citationOk,
      note: 'heuristic: correct = answered + cited the expected document',
    };
  }
  if (refused) return { verdict: 'correct_refusal', citation_ok: !citedDoc, note: 'heuristic' };
  return { verdict: 'should_have_refused', citation_ok: false, note: 'heuristic' };
}

async function llmGrade(
  c: EvalCase,
  answer: { text: string; confidence: string },
  citedDoc: string | null,
): Promise<{ verdict: Verdict; citation_ok: boolean; note: string }> {
  const raw = await generateText({
    system: GRADER_PROMPT,
    user: JSON.stringify({
      question: c.question,
      answerable: c.answerable,
      expected_doc: c.expected_doc,
      expected_facts: c.expected_facts,
      answer_text: answer.text,
      confidence: answer.confidence,
      cited_doc: citedDoc,
    }),
    maxTokens: 300,
    temperature: 0,
  });
  const parsed = extractJson<{ verdict: Verdict; citation_ok: boolean; note?: string }>(raw);
  return { verdict: parsed.verdict, citation_ok: parsed.citation_ok, note: parsed.note ?? '' };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const evalFile = fs.existsSync(V1) ? V1 : STARTER;
  const cases: EvalCase[] = fs
    .readFileSync(evalFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalCase);

  const db = getDb();
  const [owner] = await db.select().from(users).where(eq(users.email, 'demo@establo.app'));
  if (!owner) {
    console.error('Demo org not found — run `pnpm seed` first.');
    process.exit(1);
  }
  const orgDocs = await db
    .select({ title: sopDocuments.title })
    .from(sopDocuments)
    .where(eq(sopDocuments.orgId, owner.orgId));
  const realTitles = new Set(orgDocs.map((d) => d.title));

  console.log(`\nEstablo eval — ${cases.length} cases from ${path.basename(evalFile)}`);
  console.log(
    `  pipeline: embeddings=${usingStubEmbeddings() ? 'STUB (hash)' : 'OpenAI'}, ` +
      `generation=${anthropicAvailable() ? 'Claude' : 'STUB'}, ` +
      `grader=${anthropicAvailable() ? 'Claude (LLM-as-judge)' : 'heuristic'}\n`,
  );

  const results: CaseResult[] = [];
  for (const c of cases) {
    const answer = await answerQuestion(db, owner.orgId, c.question);
    const citedDoc = citedDocOf(answer.text);
    const fabricated = citedDoc !== null && !realTitles.has(citedDoc);
    const grade = anthropicAvailable()
      ? await llmGrade(c, answer, citedDoc)
      : heuristicGrade(c, answer, citedDoc);
    results.push({
      id: c.id,
      question: c.question,
      answerable: c.answerable,
      expected_doc: c.expected_doc,
      verdict: grade.verdict,
      citation_ok: grade.citation_ok && !fabricated,
      fabricated_citation: fabricated,
      confidence: answer.confidence,
      cited_doc: citedDoc,
      answer_text: answer.text,
      note: grade.note,
    });
    const mark =
      grade.verdict === 'correct' || grade.verdict === 'correct_refusal' ? '✓' : '✗';
    console.log(`  ${mark} [${c.id}] ${grade.verdict.padEnd(20)} ${c.question.slice(0, 64)}`);
  }

  const answerable = results.filter((r) => r.answerable);
  const unanswerable = results.filter((r) => !r.answerable);
  const correct = answerable.filter((r) => r.verdict === 'correct').length;
  const wronglyRefused = answerable.filter((r) => r.verdict === 'wrongly_refused').length;
  const incorrect = answerable.filter((r) => r.verdict === 'incorrect').length;
  const correctRefusals = unanswerable.filter((r) => r.verdict === 'correct_refusal').length;
  const shouldHaveRefused = unanswerable.filter((r) => r.verdict === 'should_have_refused').length;
  const fabricated = results.filter((r) => r.fabricated_citation).length;
  const citationErrors = answerable.filter((r) => !r.citation_ok).length;

  const groundedRate = correct / Math.max(answerable.length, 1);
  const refusalRate = correctRefusals / Math.max(unanswerable.length, 1);

  console.log('\n┌──────────────────────── SCORECARD ────────────────────────┐');
  console.log(`│ Answerable set (${String(answerable.length).padStart(3)} cases)                                  │`);
  console.log(`│   grounded-correct:   ${pct(correct, answerable.length).padStart(7)}   (target ≥ 85%)            │`);
  console.log(`│   incorrect:          ${pct(incorrect, answerable.length).padStart(7)}                            │`);
  console.log(`│   wrongly refused:    ${pct(wronglyRefused, answerable.length).padStart(7)}                            │`);
  console.log(`│   citation errors:    ${String(citationErrors).padStart(7)}                            │`);
  console.log(`│ Unanswerable set (${String(unanswerable.length).padStart(3)} cases)                                │`);
  console.log(`│   correct refusal:    ${pct(correctRefusals, unanswerable.length).padStart(7)}   (target ≥ 90%)            │`);
  console.log(`│   should have refused:${pct(shouldHaveRefused, unanswerable.length).padStart(7)}                            │`);
  console.log(`│ Fabricated citations: ${String(fabricated).padStart(7)}   (target = 0)              │`);
  console.log('└───────────────────────────────────────────────────────────┘');

  const pass = groundedRate >= 0.85 && refusalRate >= 0.9 && fabricated === 0;
  if (!anthropicAvailable() || usingStubEmbeddings()) {
    console.log(
      '\n⚠ Running with stubs — these numbers measure plumbing, not real quality.' +
        '\n  Set ANTHROPIC_API_KEY + OPENAI_API_KEY and re-run for a meaningful score.',
    );
  }
  console.log(pass ? '\n✅ Targets met.' : '\n❌ Below target.');

  const outPath = path.resolve(
    __dirname,
    `../evals/results-${new Date().toISOString().slice(0, 10)}.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        evalFile: path.basename(evalFile),
        pipeline: {
          embeddings: usingStubEmbeddings() ? 'stub' : 'openai',
          generation: anthropicAvailable() ? 'claude' : 'stub',
          grader: anthropicAvailable() ? 'llm' : 'heuristic',
        },
        summary: {
          answerable: answerable.length,
          unanswerable: unanswerable.length,
          correct,
          incorrect,
          wronglyRefused,
          correctRefusals,
          shouldHaveRefused,
          fabricatedCitations: fabricated,
          citationErrors,
          groundedCorrectRate: groundedRate,
          correctRefusalRate: refusalRate,
          targetsMet: pass,
        },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Results → ${outPath}\n`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
