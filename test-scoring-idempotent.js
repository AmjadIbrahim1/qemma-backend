// backend/test-scoring-idempotent.js
// ✅ End-to-end test: proves contest scoring runs correctly and is never executed more than
// once for the same contest. Creates an ended contest with a participation + answer, calls the
// SHARED run() (used by both the cron and the startup coordinator) twice, and verifies the
// second call does not re-score (finalContestScore unchanged). Cleans up all test data.
//
// Run:  node test-scoring-idempotent.js

import prisma from './src/config/prisma.config.js';
// ✅ Import the real shared function (registers the cron at module load — harmless for a short test)
import { run } from './src/jobs/contestScoring.job.js';

const TITLE_PREFIX = '[IDEM-TEST-SCORING]';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test 3: Contest Scoring Idempotency\n');

  // ── Setup: pick a third-year Science-Maths student ──────────────────
  const student = await prisma.student.findFirst({
    where: { year: 'third', stream: 'Science-Maths' },
  });
  if (!student) { console.log('❌ No eligible student found — aborting'); process.exit(1); }
  const savedRating = student.rating; // ✅ save to restore after the test
  console.log(`  Using student ${student.id.slice(0, 8)} (rating=${savedRating})`);

  // ── Create an ENDED non-test contest (startTime -2h, duration 60 → ended 1h ago) ──
  const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const contest = await prisma.contest.create({
    data: {
      title: `${TITLE_PREFIX} Idempotent Scoring Test`,
      stream: 'Science-Maths',
      difficulty: 'Easy',
      duration: 60,
      startTime,
      isTest: false,
    },
  });
  console.log(`  Created ended test contest "${contest.title}" (${contest.id.slice(0, 8)})`);

  // ── Create 1 question + 2 options (one correct) ─────────────────────
  const question = await prisma.contestQuestion.create({
    data: { contestId: contest.id, text: '2 + 2 = ?', pointValue: 10 },
  });
  const correctOption = await prisma.contestOption.create({
    data: { contestQuestionId: question.id, text: '4', isCorrect: true },
  });
  await prisma.contestOption.create({
    data: { contestQuestionId: question.id, text: '5', isCorrect: false },
  });
  console.log(`  Created 1 question (pointValue=10) + 2 options`);

  // ── Create a participation + 1 correct answer ───────────────────────
  const participation = await prisma.contestParticipation.create({
    data: { contestId: contest.id, studentId: student.id },
  });
  await prisma.contestAnswer.create({
    data: {
      participationId: participation.id,
      contestQuestionId: question.id,
      selectedOptionId: correctOption.id,
      isCorrect: true,
      submittedAt: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago (within the contest window)
    },
  });
  console.log(`  Created 1 participation + 1 correct answer`);

  try {
    // ── Step 1: verify the participation is unscored before the run ────
    const before = await prisma.contestParticipation.findUnique({ where: { id: participation.id } });
    check('Participation is unscored before the run', before.finalContestScore === null);

    // ── Step 2: call the shared scoring run() once — should score it ───
    console.log('  → calling run() (1st run)...');
    await run();
    const after1 = await prisma.contestParticipation.findUnique({ where: { id: participation.id } });
    console.log(`  After 1st run: finalContestScore=${after1.finalContestScore}, actualRank=${after1.actualRank}`);

    check(
      '1st run scored the participation (finalContestScore set)',
      after1.finalContestScore !== null,
      `got ${after1.finalContestScore}`,
    );
    check(
      '1st run assigned a rank (actualRank set)',
      after1.actualRank !== null,
      `got ${after1.actualRank}`,
    );

    // Save the score + rating to compare after the 2nd run
    const scoreAfter1 = after1.finalContestScore;
    const ratingAfter1 = after1.ratingAfter;

    // ── Step 3: call run() AGAIN — must NOT re-score ───────────────────
    console.log('  → calling run() (2nd run)...');
    await run();
    const after2 = await prisma.contestParticipation.findUnique({ where: { id: participation.id } });
    console.log(`  After 2nd run: finalContestScore=${after2.finalContestScore}, actualRank=${after2.actualRank}`);

    check(
      '2nd run did not change finalContestScore (idempotent)',
      after2.finalContestScore === scoreAfter1,
      `before=${scoreAfter1} after=${after2.finalContestScore}`,
    );
    check(
      '2nd run did not change ratingAfter',
      after2.ratingAfter === ratingAfter1,
      `before=${ratingAfter1} after=${after2.ratingAfter}`,
    );

  } finally {
    // ── Cleanup: delete answer, participation, question+options, contest ──
    // Restore the student's original rating (scoring modifies Student.rating).
    console.log('\n  🧹 Cleaning up test data...');
    await prisma.contestAnswer.deleteMany({ where: { participationId: participation.id } });
    await prisma.contestParticipation.delete({ where: { id: participation.id } });
    await prisma.contestOption.deleteMany({ where: { contestQuestionId: question.id } });
    await prisma.contestQuestion.delete({ where: { id: question.id } });
    await prisma.contest.delete({ where: { id: contest.id } });
    await prisma.student.update({ where: { id: student.id }, data: { rating: savedRating } });
    console.log(`    Deleted answer, participation, question+options, contest`);
    console.log(`    Restored student rating to ${savedRating}`);
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
