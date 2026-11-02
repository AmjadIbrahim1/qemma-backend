// backend/test-no-rejoin-after-submit.js
// ✅ Verifies that a student cannot re-enter (rejoin) a contest after submitting it.
// Checks both backend guards:
//   1. startContest throws 409 after submission (pre-existing guard).
//   2. getMyParticipation throws 409 after submission (new guard — blocks direct-URL re-entry).
//
// Run:  node test-no-rejoin-after-submit.js

import 'dotenv/config';
import prisma from './src/config/prisma.config.js';
import contestsService from './src/modules/contests/contests.service.js';

const TITLE_PREFIX = '[REJOIN-TEST]';
const STREAM = 'Science-Maths';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: No rejoin after submission\n');

  // ── Setup: an active test contest with one question ──
  const startTime = new Date(Date.now() - 10 * 60 * 1000);
  const contest = await prisma.contest.create({
    data: {
      title:      `${TITLE_PREFIX} No Rejoin Test`,
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

  // ── Setup: a 3rd-year student with matching stream ──
  const studentUser = await prisma.user.create({
    data: {
      email:       `${TITLE_PREFIX}-student@test.com`,
      username:    `std_rejoin_test`,
      role:        'student',
      name:        'Rejoin Test Student',
      passwordHash: 'dummy',
    },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, stream: STREAM, year: 'third' },
  });
  console.log(`  Created contest + student`);

  try {
    // ── Step 1: startContest succeeds (first entry) ──
    console.log('\n  → Step 1: first startContest call...');
    let startResult;
    try {
      startResult = await contestsService.startContest(contest.id, studentUser.id);
      check('First startContest succeeds', !!startResult?.participationId);
    } catch (err) {
      check('First startContest succeeds', false, err.message);
    }

    // ── Step 2: getMyParticipation succeeds (in-progress resume) ──
    console.log('  → Step 2: getMyParticipation (in-progress resume)...');
    try {
      const p = await contestsService.getMyParticipation(contest.id, studentUser.id);
      check('getMyParticipation succeeds before submission', !!p?.participationId);
    } catch (err) {
      check('getMyParticipation succeeds before submission', false, err.message);
    }

    // ── Step 3: submit the contest ──
    console.log('  → Step 3: submit the contest...');
    try {
      await contestsService.submitContest(contest.id, studentUser.id);
      check('submitContest succeeds', true);
    } catch (err) {
      check('submitContest succeeds', false, err.message);
    }

    // ── Step 4: startContest should now throw 409 (can't rejoin) ──
    console.log('  → Step 4: startContest after submission (should 409)...');
    try {
      await contestsService.startContest(contest.id, studentUser.id);
      check('startContest blocked after submission (409)', false, 'no error thrown');
    } catch (err) {
      check('startContest blocked after submission (409)', err.statusCode === 409, `got ${err.statusCode}`);
    }

    // ── Step 5: getMyParticipation should now throw 409 (can't re-enter via direct URL) ──
    console.log('  → Step 5: getMyParticipation after submission (should 409)...');
    try {
      await contestsService.getMyParticipation(contest.id, studentUser.id);
      check('getMyParticipation blocked after submission (409)', false, 'no error thrown');
    } catch (err) {
      check('getMyParticipation blocked after submission (409)', err.statusCode === 409, `got ${err.statusCode}`);
    }

    // ── Step 6: getAvailableContests should report hasSubmitted=true ──
    console.log('  → Step 6: getAvailableContests reports hasSubmitted...');
    const available = await contestsService.getAvailableContests(studentUser.id);
    const row = available.find(c => c.id === contest.id);
    check(
      'getAvailableContests returns hasSubmitted=true for the submitted contest',
      row?.hasSubmitted === true,
      `got hasSubmitted=${row?.hasSubmitted}`,
    );

  } finally {
    // ── Cleanup ──
    console.log('\n  🧹 Cleaning up...');
    await prisma.contestAnswer.deleteMany({ where: { participation: { contestId: contest.id } } });
    await prisma.contestParticipation.deleteMany({ where: { contestId: contest.id } });
    await prisma.contestOption.deleteMany({ where: { contestQuestion: { contestId: contest.id } } });
    await prisma.contestQuestion.deleteMany({ where: { contestId: contest.id } });
    await prisma.contest.delete({ where: { id: contest.id } });
    await prisma.student.deleteMany({ where: { userId: studentUser.id } });
    await prisma.user.deleteMany({ where: { id: studentUser.id } });
    console.log('    Done');
  }

  const total = passed + failed;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) { console.log(`  ${failed} FAILED:`); errors.forEach(e => console.log(e)); process.exit(1); }
  else { console.log('  🎉 All tests passed!'); }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(e => { console.error('❌ Test error:', e); process.exit(1); });
