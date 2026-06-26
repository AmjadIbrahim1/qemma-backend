// backend/test-reminder-idempotent.js
// ✅ End-to-end test: proves contest notifications are sent correctly and never duplicated.
// Creates a test contest within the 48h reminder window, calls the SHARED runStartupCatchUp()
// (used by both the cron `run` and the startup coordinator) twice, and verifies the second
// call sends zero new notifications. Cleans up all test data afterwards.
//
// Run:  node test-reminder-idempotent.js

import prisma from './src/config/prisma.config.js';
// ✅ Import the real shared function (registers the cron at module load — harmless for a short test)
import { runStartupCatchUp } from './src/jobs/contestReminder.job.js';

const TITLE_PREFIX = '[IDEM-TEST-REMINDER]';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test 2: Contest Reminder Idempotency\n');

  // ── Setup: create a non-test contest starting in ~24h (within the ≤48h window) ──
  // Stream = Science-Maths (3 third-year students match — verified via probe).
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const contest = await prisma.contest.create({
    data: {
      title: `${TITLE_PREFIX} Idempotent Reminder Test`,
      stream: 'Science-Maths',
      difficulty: 'Easy',
      duration: 60,
      startTime,
      isTest: false,
    },
  });
  console.log(`  Created test contest "${contest.title}" (${contest.id.slice(0, 8)})`);
  console.log(`  startTime = ${startTime.toISOString()} (in 24h, within ≤48h window)`);

  try {
    // ── Helper: count reminder notifications for this specific contest ──
    const countNotifs = () => prisma.notification.count({
      where: { type: 'contest_reminder', data: { path: ['contestId'], equals: contest.id } },
    });

    // ── Step 1: no notifications exist yet for this contest ────────────
    const before = await countNotifs();
    console.log(`  Notifications before: ${before}`);
    check('No notifications exist before the first run', before === 0, `got ${before}`);

    // ── Step 2: call the shared function once — should send reminders ──
    console.log('  → calling runStartupCatchUp() (1st run)...');
    await runStartupCatchUp();
    const after1 = await countNotifs();
    console.log(`  Notifications after 1st run: ${after1}`);

    check(
      '1st run sent at least 1 notification',
      after1 > 0,
      `got ${after1} (expected ≥1 — 3 third-year Science-Maths students + teachers)`,
    );

    // ── Step 3: call it AGAIN — must send zero new notifications ───────
    console.log('  → calling runStartupCatchUp() (2nd run)...');
    await runStartupCatchUp();
    const after2 = await countNotifs();
    console.log(`  Notifications after 2nd run: ${after2}`);

    check(
      '2nd run sent no new notifications (idempotent)',
      after2 === after1,
      `before=${after1} after=${after2}`,
    );

  } finally {
    // ── Cleanup: delete notifications for this contest + the test contest ──
    console.log('\n  🧹 Cleaning up test data...');
    const delNotifs = await prisma.notification.deleteMany({
      where: { type: 'contest_reminder', data: { path: ['contestId'], equals: contest.id } },
    });
    console.log(`    Deleted ${delNotifs.count} test notifications`);
    await prisma.contest.delete({ where: { id: contest.id } });
    console.log(`    Deleted test contest`);
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
