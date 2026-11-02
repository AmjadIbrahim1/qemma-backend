// backend/test-test-contest-availability.js
// ✅ Verifies that test contests (isTest=true) are always available until their termination
// time, regardless of the start-time window. Creates a test contest starting in the FUTURE
// (outside the normal availability window) with a long duration, then checks:
//   1. _formatContestSummary returns status='active' (not 'upcoming') for the test contest.
//   2. A teacher can add questions (addContestQuestion succeeds).
//   3. An eligible 3rd-year student with matching stream can start the contest (startContest succeeds).
//
// Run:  node test-test-contest-availability.js

import 'dotenv/config';
import prisma from './src/config/prisma.config.js';
import contestsService from './src/modules/contests/contests.service.js';

const TITLE_PREFIX = '[AVAIL-TEST]';
const STREAM = 'Science-Maths';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: Test Contest Availability (isTest bypasses start-time window)\n');

  // ── Setup: create a test contest starting 1 day in the future (outside normal window) ──
  // Duration = 7 days so the end time is well in the future (contest not yet terminated).
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);   // +1 day
  const duration  = 7 * 24 * 60;                                   // 7 days in minutes
  const contest = await prisma.contest.create({
    data: {
      title:      `${TITLE_PREFIX} Future-Start Test Contest`,
      stream:     STREAM,
      difficulty: 'Easy',
      duration,
      startTime,
      isTest:     true,
    },
  });
  console.log(`  Created test contest (isTest=true, starts in 1 day, duration 7 days)`);

  // ── Setup: create a temporary teacher user + profile with matching stream ──
  const teacherUser = await prisma.user.create({
    data: {
      email:    `${TITLE_PREFIX}-teacher@test.com`,
      username: `tch_avail_test`,
      role:     'teacher',
      name:     'Availability Test Teacher',
      passwordHash: 'dummy',
    },
  });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, stream: STREAM },
  });
  console.log(`  Created teacher (stream=${STREAM})`);

  // ── Setup: create a temporary student user + profile (3rd year, matching stream) ──
  const studentUser = await prisma.user.create({
    data: {
      email:    `${TITLE_PREFIX}-student@test.com`,
      username: `std_avail_test`,
      role:     'student',
      name:     'Availability Test Student',
      passwordHash: 'dummy',
    },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, stream: STREAM, year: 'third' },
  });
  console.log(`  Created student (year=third, stream=${STREAM})`);

  try {
    // ── Check 1: _formatContestSummary status should be 'active' (not 'upcoming') ──
    // This is the root-cause fix — test contests ignore the start-time window.
    const summary = contestsService._formatContestSummary(contest, new Date());
    check(
      `Summary status is 'active' (not 'upcoming') for future-start test contest`,
      summary.status === 'active',
      `got status='${summary.status}'`,
    );
    check(
      'Summary includes isTest=true',
      summary.isTest === true,
      `got isTest=${summary.isTest}`,
    );

    // ── Check 2: teacher can add questions (outside normal window) ──
    // The contest starts in 1 day — for a non-test contest, the 60-min lock would NOT
    // apply yet (we're >60min before start), so this would pass for non-test too.
    // The real test is that it works EVEN within the 60-min lock window for test contests.
    // We'll verify both: now (>60min before start) AND move the start time to ~30min from
    // now (inside the 60-min lock window) to prove the isTest bypass works.
    console.log('\n  → Phase A: teacher adds questions (>60min before start)...');
    let qResult;
    try {
      qResult = await contestsService.addContestQuestion(contest.id, teacherUser.id, {
        text:    'What is 2 + 2?',
        options: [
          { text: '3', isCorrect: false },
          { text: '4', isCorrect: true  },
        ],
      });
      check('Teacher can add questions (>60min before start)', true);
    } catch (err) {
      check('Teacher can add questions (>60min before start)', false, err.message);
    }

    // ── Phase B: move start time to 30 min from now (inside the 60-min lock window) ──
    // For a non-test contest, this would block question adding. For a test contest, it must still work.
    console.log('  → Phase B: move start to 30min from now (inside 60-min lock window)...');
    await prisma.contest.update({
      where:  { id: contest.id },
      data:   { startTime: new Date(Date.now() + 30 * 60 * 1000) },
    });

    try {
      await contestsService.addContestQuestion(contest.id, teacherUser.id, {
        text:    'What is 3 + 3?',
        options: [
          { text: '5', isCorrect: false },
          { text: '6', isCorrect: true  },
        ],
      });
      check('Teacher can add questions (inside 60-min lock window — isTest bypass)', true);
    } catch (err) {
      check('Teacher can add questions (inside 60-min lock window — isTest bypass)', false, err.message);
    }

    // ── Check 3: eligible student can start the contest ──
    // The contest starts in 30 min — for a non-test contest, this would block with
    // 'Contest has not started yet'. For a test contest, it must still work.
    console.log('  → Phase C: student starts the contest (start time is 30min in the future)...');
    try {
      const startResult = await contestsService.startContest(contest.id, studentUser.id);
      check('Eligible student can start the contest (before start time — isTest bypass)', true);
      check(
        'startContest returned questions',
        Array.isArray(startResult.questions) && startResult.questions.length >= 2,
        `got ${startResult.questions?.length} questions`,
      );
    } catch (err) {
      check('Eligible student can start the contest (before start time — isTest bypass)', false, err.message);
    }

    // ── Check 4: non-eligible student (wrong stream) is denied ──
    console.log('  → Phase D: wrong-stream student is denied...');
    const wrongStudentUser = await prisma.user.create({
      data: {
        email:    `${TITLE_PREFIX}-wrong@test.com`,
        username: `std_avail_wrong`,
        role:     'student',
        name:     'Wrong Stream Student',
        passwordHash: 'dummy',
      },
    });
    const wrongStudent = await prisma.student.create({
      data: { userId: wrongStudentUser.id, stream: 'Literary', year: 'third' },
    });
    try {
      await contestsService.startContest(contest.id, wrongStudentUser.id);
      check('Wrong-stream student is denied (403)', false, 'no error thrown');
    } catch (err) {
      check('Wrong-stream student is denied (403)', err.statusCode === 403, `got ${err.statusCode}`);
    }

    // ── Check 5: non-3rd-year student is denied ──
    console.log('  → Phase E: 2nd-year student is denied...');
    const youngStudentUser = await prisma.user.create({
      data: {
        email:    `${TITLE_PREFIX}-young@test.com`,
        username: `std_avail_young`,
        role:     'student',
        name:     'Young Student',
        passwordHash: 'dummy',
      },
    });
    const youngStudent = await prisma.student.create({
      data: { userId: youngStudentUser.id, stream: STREAM, year: 'second' },
    });
    try {
      await contestsService.startContest(contest.id, youngStudentUser.id);
      check('2nd-year student is denied (403)', false, 'no error thrown');
    } catch (err) {
      check('2nd-year student is denied (403)', err.statusCode === 403, `got ${err.statusCode}`);
    }

    // Cleanup extra users
    await prisma.student.deleteMany({ where: { userId: { in: [wrongStudentUser.id, youngStudentUser.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [wrongStudentUser.id, youngStudentUser.id] } } });

  } finally {
    // ── Cleanup: delete participations, options, questions, contest, users ──
    console.log('\n  🧹 Cleaning up test data...');
    await prisma.contestAnswer.deleteMany({
      where: { participation: { contestId: contest.id } },
    });
    await prisma.contestParticipation.deleteMany({ where: { contestId: contest.id } });
    await prisma.contestOption.deleteMany({
      where: { contestQuestion: { contestId: contest.id } },
    });
    await prisma.contestQuestion.deleteMany({ where: { contestId: contest.id } });
    await prisma.contest.delete({ where: { id: contest.id } });
    await prisma.student.deleteMany({ where: { userId: studentUser.id } });
    await prisma.teacher.deleteMany({ where: { userId: teacherUser.id } });
    await prisma.user.deleteMany({ where: { id: { in: [studentUser.id, teacherUser.id] } } });
    console.log('    Cleaned up contest, questions, options, users');
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
