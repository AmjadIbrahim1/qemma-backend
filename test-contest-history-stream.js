// backend/test-contest-history-stream.js
// ✅ Verifies that getMyHistory returns ALL ended contests matching the student's stream,
// regardless of whether the student participated. Also verifies contests from other streams
// are NOT returned.
//
// Creates:
//   - A 3rd-year student (stream = Science-Maths).
//   - 3 ended contests: 2 Science-Maths (one participated, one NOT), 1 Literary (not participated).
//   - 1 non-ended Science-Maths contest (should NOT appear in history).
// Then calls contestsService.getMyHistory and checks the returned set.
//
// Run:  node test-contest-history-stream.js

import 'dotenv/config';
import prisma from './src/config/prisma.config.js';
import contestsService from './src/modules/contests/contests.service.js';

const TITLE_PREFIX = '[HIST-TEST]';
const MY_STREAM = 'Science-Maths';
const OTHER_STREAM = 'Literary';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test: Contest History — Stream Filter (participation-independent)\n');

  // ── Setup: student (3rd year, Science-Maths) ──
  const studentUser = await prisma.user.create({
    data: {
      email:       `${TITLE_PREFIX}-student@test.com`,
      username:    `std_hist_test`,
      role:        'student',
      name:        'History Test Student',
      passwordHash: 'dummy',
    },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, stream: MY_STREAM, year: 'third' },
  });
  console.log(`  Created student (year=third, stream=${MY_STREAM})`);

  // ── Helper: create a contest that ended 1 hour ago ──
  async function endedContest(stream, titleSuffix) {
    const duration = 30;
    const startTime = new Date(Date.now() - (duration + 60) * 60 * 1000); // started (duration+60) min ago
    return prisma.contest.create({
      data: {
        title:      `${TITLE_PREFIX} ${titleSuffix}`,
        stream,     difficulty: 'Easy', duration, startTime, isTest: true,
      },
    });
  }
  // ── Helper: create a contest that is still active (not ended) ──
  async function activeContest(stream, titleSuffix) {
    const startTime = new Date(Date.now() - 10 * 60 * 1000); // started 10 min ago
    return prisma.contest.create({
      data: {
        title:      `${TITLE_PREFIX} ${titleSuffix}`,
        stream,     difficulty: 'Easy', duration: 30, startTime, isTest: true,
      },
    });
  }

  const cEndedMineParticip  = await endedContest(MY_STREAM,    'Ended Mine Participated');
  const cEndedMineNoParticip = await endedContest(MY_STREAM,    'Ended Mine NOT Participated');
  const cEndedOtherStream   = await endedContest(OTHER_STREAM, 'Ended Other Stream');
  const cActiveMine         = await activeContest(MY_STREAM,    'Active Mine (should NOT appear)');
  console.log(`  Created 4 contests (2 ended mine, 1 ended other-stream, 1 active mine)`);

  // ── Seed a participation for the student in ONE of the ended mine-stream contests ──
  await prisma.contestParticipation.create({
    data: { contestId: cEndedMineParticip.id, studentId: student.id },
  });
  // Add a question to the participated contest so it's a realistic scenario
  await prisma.contestQuestion.create({
    data: { contestId: cEndedMineParticip.id, text: 'q1', pointValue: 1, aiGenerated: false },
  });
  console.log(`  Seeded 1 participation (in "${cEndedMineParticip.title}")`);

  const createdIds = [cEndedMineParticip.id, cEndedMineNoParticip.id, cEndedOtherStream.id, cActiveMine.id];

  try {
    // ── Call getMyHistory ──
    const history = await contestsService.getMyHistory(studentUser.id);
    const historyIds = new Set(history.map(h => h.id));
    console.log(`  getMyHistory returned ${history.length} contest(s)`);

    // ── Check 1: ended mine-stream contest WITH participation is shown ──
    check(
      'Ended mine-stream contest (participated) is shown',
      historyIds.has(cEndedMineParticip.id),
    );

    // ── Check 2: ended mine-stream contest WITHOUT participation is shown ──
    check(
      'Ended mine-stream contest (NOT participated) is shown',
      historyIds.has(cEndedMineNoParticip.id),
    );

    // ── Check 3: ended other-stream contest is NOT shown ──
    check(
      'Ended other-stream contest is NOT shown',
      !historyIds.has(cEndedOtherStream.id),
    );

    // ── Check 4: active (non-ended) contest is NOT shown ──
    check(
      'Active (non-ended) mine-stream contest is NOT shown',
      !historyIds.has(cActiveMine.id),
    );

    // ── Check 5: returned contests include participation status (myParticipation field) ──
    const participatedRow = history.find(h => h.id === cEndedMineParticip.id);
    check(
      'Participated contest has myParticipation set',
      !!participatedRow?.myParticipation,
      `myParticipation=${JSON.stringify(participatedRow?.myParticipation)}`,
    );
    const notParticipatedRow = history.find(h => h.id === cEndedMineNoParticip.id);
    check(
      'Non-participated contest has myParticipation null',
      notParticipatedRow?.myParticipation == null,
      `myParticipation=${JSON.stringify(notParticipatedRow?.myParticipation)}`,
    );

  } finally {
    // ── Cleanup ──
    console.log('\n  🧹 Cleaning up test data...');
    await prisma.contestAnswer.deleteMany({
      where: { participation: { contestId: { in: createdIds } } },
    });
    await prisma.contestParticipation.deleteMany({ where: { contestId: { in: createdIds } } });
    await prisma.contestOption.deleteMany({
      where: { contestQuestion: { contestId: { in: createdIds } } },
    });
    await prisma.contestQuestion.deleteMany({ where: { contestId: { in: createdIds } } });
    await prisma.contest.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.student.deleteMany({ where: { userId: studentUser.id } });
    await prisma.user.deleteMany({ where: { id: studentUser.id } });
    console.log('    Cleaned up contests, participations, questions, student, user');
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
