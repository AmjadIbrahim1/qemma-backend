// backend/test-start-contest-race.js
// ✅ Verifies that startContest is race-safe when two concurrent calls try to create a
// participation for the same student+contest. Before the fix, the second call hit a P2002
// unique violation (→ 409 "A record with this value already exists"). After the fix, the
// second call should catch the P2002, re-fetch the participation, and resume it.
//
// Also verifies a single first attempt succeeds (the reported user-facing symptom).
//
// Run:  node test-start-contest-race.js

import 'dotenv/config';
import prisma from './src/config/prisma.config.js';
import contestsService from './src/modules/contests/contests.service.js';

const TITLE_PREFIX = '[RACE-TEST]';
const STREAM = 'Science-Maths';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: startContest race-safety (concurrent participation creation)\n');

  // ── Setup: an active test contest with one question ──
  const startTime = new Date(Date.now() - 10 * 60 * 1000); // started 10 min ago
  const contest = await prisma.contest.create({
    data: {
      title:      `${TITLE_PREFIX} Race Test Contest`,
      stream:     STREAM,
      difficulty: 'Easy',
      duration:   60,
      startTime,
      isTest:     true,
    },
  });
  const q = await prisma.contestQuestion.create({
    data: { contestId: contest.id, text: '2+2?', pointValue: 1, aiGenerated: false },
  });
  await prisma.contestOption.create({ data: { contestQuestionId: q.id, text: '4', isCorrect: true  } });
  await prisma.contestOption.create({ data: { contestQuestionId: q.id, text: '5', isCorrect: false } });
  await prisma.contest.update({ where: { id: contest.id }, data: { questionCount: 1 } });
  console.log(`  Created test contest + 1 question`);

  // ── Setup: a 3rd-year student with matching stream ──
  const studentUser = await prisma.user.create({
    data: {
      email:       `${TITLE_PREFIX}-student@test.com`,
      username:    `std_race_test`,
      role:        'student',
      name:        'Race Test Student',
      passwordHash: 'dummy',
    },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, stream: STREAM, year: 'third' },
  });
  console.log(`  Created student (year=third, stream=${STREAM})`);

  try {
    // ── Check 1: single first attempt succeeds (the reported user-facing symptom) ──
    console.log('\n  → Phase A: single first attempt...');
    let firstResult;
    try {
      firstResult = await contestsService.startContest(contest.id, studentUser.id);
      check('First startContest call succeeds', true);
    } catch (err) {
      check('First startContest call succeeds', false, err.message);
    }
    if (firstResult) {
      check(
        'First call returned a participationId',
        !!firstResult.participationId,
        `got ${firstResult.participationId}`,
      );
      check(
        'First call returned 1 question',
        firstResult.questions?.length === 1,
        `got ${firstResult.questions?.length}`,
      );
    }

    // ── Cleanup the participation so we can test the race from a clean slate ──
    await prisma.contestAnswer.deleteMany({ where: { participation: { contestId: contest.id } } });
    await prisma.contestParticipation.deleteMany({ where: { contestId: contest.id } });
    console.log('\n  → Cleared participation for the race test');

    // ── Check 2: two CONCURRENT startContest calls — both should resolve, no P2002 ──
    console.log('  → Phase B: two concurrent startContest calls (race condition)...');
    const results = await Promise.allSettled([
      contestsService.startContest(contest.id, studentUser.id),
      contestsService.startContest(contest.id, studentUser.id),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected  = results.filter(r => r.status === 'rejected');
    console.log(`    ${fulfilled.length} fulfilled, ${rejected.length} rejected`);

    check(
      'Both concurrent calls succeeded (no P2002 / 409)',
      fulfilled.length === 2 && rejected.length === 0,
      rejected.map(r => r.reason?.message).join('; '),
    );
    if (fulfilled.length === 2) {
      check(
        'Both calls returned the same participationId (one row, not two)',
        fulfilled[0].value.participationId === fulfilled[1].value.participationId,
        `${fulfilled[0].value.participationId} vs ${fulfilled[1].value.participationId}`,
      );
    }

    // ── Check 3: only one participation row exists in the DB ──
    const rows = await prisma.contestParticipation.findMany({
      where: { contestId: contest.id, studentId: student.id },
    });
    check(
      'Exactly one participation row exists in the DB',
      rows.length === 1,
      `found ${rows.length}`,
    );

  } finally {
    // ── Cleanup ──
    console.log('\n  🧹 Cleaning up test data...');
    await prisma.contestAnswer.deleteMany({ where: { participation: { contestId: contest.id } } });
    await prisma.contestParticipation.deleteMany({ where: { contestId: contest.id } });
    await prisma.contestOption.deleteMany({ where: { contestQuestion: { contestId: contest.id } } });
    await prisma.contestQuestion.deleteMany({ where: { contestId: contest.id } });
    await prisma.contest.delete({ where: { id: contest.id } });
    await prisma.student.deleteMany({ where: { userId: studentUser.id } });
    await prisma.user.deleteMany({ where: { id: studentUser.id } });
    console.log('    Cleaned up contest, questions, options, participation, student, user');
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ${failed} FAILED:`); errors.forEach(e => console.log(e)); process.exit(1); }
  else { console.log('  🎉 All tests passed!'); }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(e => { console.error('❌ Test error:', e); process.exit(1); });
