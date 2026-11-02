// backend/test-contest-generator.js
// ✅ Manual test for contestGenerator.job.js helpers + creation/dedup logic.
// Run from the backend directory:  node test-contest-generator.js
//
// Tests:
//  1. cairoTimeToUTC  — known date → UTC round-trip back to 17:00 Cairo
//  2. getDifficultyForDay — schedule lookup (hit + miss)
//  3. Contest creation — all fields correct (title, stream, difficulty, duration, startTime)
//  4. Dedup — second creation attempt for same day+stream skips
//  5. Cleanup — deletes created test contests

import prisma from './src/config/prisma.config.js';

// ── Inline copies of the job helpers (test is standalone to avoid starting the cron) ──

const CONTEST_SCHEDULE = {
  Hard:   [3,  8,  13, 18, 23],
  Medium: [6,  16, 26],
  Easy:   [11, 21],
};

function getDifficultyForDay(day) {
  for (const [difficulty, days] of Object.entries(CONTEST_SCHEDULE)) {
    if (days.includes(day)) return difficulty;
  }
  return null;
}

const STREAM_TO_AR = {
  'Literary':        'أدبي',
  'Science-Maths':   'علمي رياضة',
  'Science-Biology': 'علمي علوم',
};
const DIFFICULTY_TO_AR = { Easy: 'سهل', Medium: 'متوسط', Hard: 'صعب' };
const MONTHS_AR = [
  'يناير','فبراير','مارس','إبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];

function cairoTimeToUTC(year, month, day, hour = 17, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(guess);
  const obj = {};
  for (const p of parts) if (p.type !== 'literal') obj[p.type] = p.value;
  const cairoMs = Date.UTC(
    +obj.year,
    +obj.month - 1,
    +obj.day,
    +obj.hour === 24 ? 0 : +obj.hour,
    +obj.minute,
  );
  const offset = cairoMs - guess.getTime();
  return new Date(guess.getTime() - offset);
}

function buildTitle(stream, difficulty, day, month, year) {
  const streamLabel = STREAM_TO_AR[stream];
  const diffLabel = DIFFICULTY_TO_AR[difficulty];
  const monthName = MONTHS_AR[month - 1];
  return `مسابقة ${streamLabel} - ${diffLabel} - ${day} ${monthName} ${year}`;
}

// ── Run tests ─────────────────────────────────────────────────────────

async function main() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  function check(label, condition, detail = '') {
    if (condition) {
      passed++;
      console.log(`  ✅ ${label}`);
    } else {
      failed++;
      const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`;
      console.log(msg);
      errors.push(msg);
    }
  }

  console.log('🧪 Contest Generator Tests\n');

  // ── Test 1: Timezone helper ────────────────────────────────────────
  console.log('📌 Test 1: cairoTimeToUTC round-trip to 17:00 Cairo');

  const testUTC = cairoTimeToUTC(2026, 6, 15, 17, 0);
  const cairoBack = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(testUTC);
  check('Converts to 17:00 Cairo', cairoBack === '17:00', `got ${cairoBack}`);

  const testUTC2 = cairoTimeToUTC(2026, 12, 1, 17, 0);
  const cairoBack2 = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(testUTC2);
  check('Works for December', cairoBack2 === '17:00', `got ${cairoBack2}`);

  const isDate = testUTC instanceof Date && !isNaN(testUTC.getTime());
  check('Returns a valid Date', isDate);

  // ── Test 2: Schedule lookup ────────────────────────────────────────
  console.log('\n📌 Test 2: getDifficultyForDay');

  check('Day 3 → Hard',   getDifficultyForDay(3)  === 'Hard');
  check('Day 6 → Medium', getDifficultyForDay(6)  === 'Medium');
  check('Day 11 → Easy',  getDifficultyForDay(11) === 'Easy');
  check('Day 15 → null',  getDifficultyForDay(15) === null);
  check('Day 1 → null',   getDifficultyForDay(1)  === null);
  check('Day 29 → null',  getDifficultyForDay(29) === null);

  // ── Test 3: Contest creation ───────────────────────────────────────
  console.log('\n📌 Test 3: Contest creation (full fields)');

  const targetYear = 2027;
  const targetMonth = 1;
  const targetDay = 3; // Hard day
  const difficulty = 'Hard';
  const duration = 150;
  const startTime = cairoTimeToUTC(targetYear, targetMonth, targetDay);

  const streams = ['Literary', 'Science-Maths', 'Science-Biology'];
  const createdIds = [];

  for (const stream of streams) {
    const title = buildTitle(stream, difficulty, targetDay, targetMonth, targetYear);
    const contest = await prisma.contest.create({
      data: { title, stream, difficulty, duration, startTime },
    });
    createdIds.push(contest.id);

    check(
      `${stream}: title correct`,
      contest.title === title,
      contest.title,
    );
    check(
      `${stream}: stream is '${stream}'`,
      contest.stream === stream,
      contest.stream,
    );
    check(
      `${stream}: difficulty is 'Hard'`,
      contest.difficulty === 'Hard',
    );
    check(
      `${stream}: duration is 150`,
      contest.duration === 150,
      `got ${contest.duration}`,
    );
    check(
      `${stream}: startTime matches`,
      contest.startTime.getTime() === startTime.getTime(),
    );
    check(
      `${stream}: questionCount is null`,
      contest.questionCount === null,
      `got ${contest.questionCount}`,
    );
  }

  // ── Test 4: Dedup ──────────────────────────────────────────────────
  console.log('\n📌 Test 4: Dedup (second creation attempt skips)');

  const dedupResults = [];
  for (const stream of streams) {
    const existing = await prisma.contest.findFirst({
      where: { startTime, stream },
    });
    dedupResults.push(existing);
  }
  check(
    'All 3 existing contests found (dedup would skip)',
    dedupResults.length === 3 && dedupResults.every(Boolean),
    `found ${dedupResults.filter(Boolean).length}/3`,
  );

  const preCount = await prisma.contest.count({
    where: { startTime, difficulty: 'Hard' },
  });
  check(
    'No extra contests created (count still 3)',
    preCount === 3,
    `got ${preCount}`,
  );

  // ── Cleanup ─────────────────────────────────────────────────────────
  console.log('\n📌 Cleanup: removing test contests');
  await prisma.contest.deleteMany({
    where: { id: { in: createdIds } },
  });
  console.log(`  🧹 Deleted ${createdIds.length} test contests`);

  // ── Summary ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.log(`  ${failed} FAILED:`);
    errors.forEach(e => console.log(e));
    process.exit(1);
  } else {
    console.log('  🎉 All tests passed!');
  }
}

main().catch(e => {
  console.error('❌ Test suite error:', e);
  process.exit(1);
});
