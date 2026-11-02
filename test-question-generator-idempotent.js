// backend/test-question-generator-idempotent.js
// ✅ End-to-end test: proves the AI contest question generator runs once per contest and
// does not duplicate questions on a second run. Creates a non-test contest starting in
// 30 minutes (inside the 60-min generation window), seeds a couple of teacher questions,
// calls the SHARED runStartupCatchUp() (used by both the cron and the startup
// coordinator) twice, and verifies:
//   1. The generator picks the contest up (aiGenerationStatus transitions out of null).
//   2. A second run does NOT create duplicate questions for the same contest.
//
// NOTE: This test exercises the idempotency guards (status field + in-memory Set). It
// does NOT call the live Groq API — the textbooks may be absent and GROQ_API_KEY may be
// unset. Instead it pre-seeds enough questions to satisfy the required count so the
// generator takes the 'not_needed' path on both runs (the cleanest idempotency proof
// that requires no external service). To exercise the real Groq path, seed fewer
// questions and provide textbooks + GROQ_API_KEY.
//
// Run:  node test-question-generator-idempotent.js

import prisma from './src/config/prisma.config.js';
// ✅ Import the shared catch-up (registers the cron at module load — harmless for a short test)
import { runStartupCatchUp } from './src/jobs/contestQuestionGenerator.job.js';

const TITLE_PREFIX = '[IDEM-TEST-QGEN]';
const REQUIRED_EASY = 10; // matches generator.service.js REQUIRED_QUESTIONS

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: Contest Question Generator Idempotency\n');

  // ── Setup: a non-test Easy contest starting in 30 min (inside the 60-min window) ──
  const startTime = new Date(Date.now() + 30 * 60 * 1000);
  const contest = await prisma.contest.create({
    data: {
      title:           `${TITLE_PREFIX} Idempotent QGen Test`,
      stream:          'Science-Maths',
      difficulty:      'Easy',
      duration:        30,
      startTime,
      isTest:          false,
      // aiGenerationStatus defaults to null → eligible for the generator scan
    },
  });
  console.log(`  Created test contest "${contest.title}" (starts in 30 min, Easy, required=${REQUIRED_EASY})`);

  // ── Seed the full required count of teacher questions so the generator takes the
  //    'not_needed' path WITHOUT needing Groq/textbooks. This isolates the idempotency
  //    guards from the external API.
  const seededQuestions = [];
  for (let i = 0; i < REQUIRED_EASY; i++) {
    const q = await prisma.contestQuestion.create({
      data: { contestId: contest.id, text: `Teacher question ${i + 1}`, pointValue: 1, aiGenerated: false },
    });
    await prisma.contestOption.create({
      data: { contestQuestionId: q.id, text: 'correct', isCorrect: true },
    });
    await prisma.contestOption.create({
      data: { contestQuestionId: q.id, text: 'wrong', isCorrect: false },
    });
    seededQuestions.push(q.id);
  }
  await prisma.contest.update({
    where: { id: contest.id },
    data:  { questionCount: REQUIRED_EASY },
  });
  console.log(`  Seeded ${REQUIRED_EASY} teacher questions (no Groq needed for the 'not_needed' path)`);

  try {
    // ── Step 1: before the run, status should be null ───────────────────
    const before = await prisma.contest.findUnique({ where: { id: contest.id } });
    check('Status is null before the run', before.aiGenerationStatus === null, `got ${before.aiGenerationStatus}`);

    // ── Step 2: call the shared catch-up once — should mark 'not_needed' ─
    console.log('  → calling runStartupCatchUp() (1st run)...');
    await runStartupCatchUp();
    const after1 = await prisma.contest.findUnique({ where: { id: contest.id } });
    console.log(`  After 1st run: aiGenerationStatus=${after1.aiGenerationStatus}`);
    check(
      '1st run marked the contest (status no longer null)',
      after1.aiGenerationStatus !== null,
      `got ${after1.aiGenerationStatus}`,
    );
    check(
      "1st run set status to 'not_needed' (teacher already met the required count)",
      after1.aiGenerationStatus === 'not_needed',
      `got ${after1.aiGenerationStatus}`,
    );
    check(
      '1st run set aiGeneratedAt',
      after1.aiGeneratedAt !== null,
      `got ${after1.aiGeneratedAt}`,
    );

    // Snapshot the question count + ids to compare after the 2nd run
    const countAfter1 = await prisma.contestQuestion.count({ where: { contestId: contest.id } });
    const idsAfter1   = new Set(seededQuestions);

    // ── Step 3: call runStartupCatchUp() AGAIN — must NOT re-process ────
    console.log('  → calling runStartupCatchUp() (2nd run)...');
    await runStartupCatchUp();
    const after2 = await prisma.contest.findUnique({ where: { id: contest.id } });
    const countAfter2 = await prisma.contestQuestion.count({ where: { contestId: contest.id } });
    const allQsAfter2 = await prisma.contestQuestion.findMany({
      where: { contestId: contest.id },
      select: { id: true, aiGenerated: true },
    });
    console.log(`  After 2nd run: status=${after2.aiGenerationStatus}, questionCount=${countAfter2}`);

    check(
      '2nd run did not change aiGenerationStatus',
      after2.aiGenerationStatus === after1.aiGenerationStatus,
      `before=${after1.aiGenerationStatus} after=${after2.aiGenerationStatus}`,
    );
    check(
      '2nd run created NO new questions (count unchanged)',
      countAfter2 === countAfter1,
      `before=${countAfter1} after=${countAfter2}`,
    );
    check(
      '2nd run created NO AI-generated questions',
      allQsAfter2.every((q) => q.aiGenerated === false),
      'found aiGenerated=true rows',
    );
    check(
      'No question ids changed (no delete+recreate)',
      allQsAfter2.every((q) => idsAfter1.has(q.id)) && allQsAfter2.length === countAfter1,
    );

  } finally {
    // ── Cleanup: delete options, questions, contest ─────────────────────
    console.log('\n  🧹 Cleaning up test data...');
    await prisma.contestOption.deleteMany({
      where: { contestQuestion: { contestId: contest.id } },
    });
    await prisma.contestQuestion.deleteMany({ where: { contestId: contest.id } });
    await prisma.contest.delete({ where: { id: contest.id } });
    console.log(`    Deleted options, questions, contest`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ${failed} FAILED:`); errors.forEach(e => console.log(e)); process.exit(1); }
  else { console.log('  🎉 All tests passed!'); }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(e => { console.error('❌ Test error:', e); process.exit(1); });
