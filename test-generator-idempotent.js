// backend/test-generator-idempotent.js
// ✅ End-to-end test: proves contest generation runs correctly and never generates duplicates.
// Calls the SHARED runStartupCatchUp() (used by both the cron `run` and the startup coordinator)
// twice and verifies no duplicate (startTime, stream) contests are created.
//
// Run:  node test-generator-idempotent.js

import prisma from './src/config/prisma.config.js';
// ✅ Import the real shared function (registers the cron at module load — harmless for a short test)
import { runStartupCatchUp } from './src/jobs/contestGenerator.job.js';

async function main() {
  let passed = 0, failed = 0;
  const errors = [];
  function check(label, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; const msg = `  ❌ ${label}${detail ? ` — ${detail}` : ''}`; console.log(msg); errors.push(msg); }
  }

  console.log('🧪 Test 1: Contest Generation Idempotency\n');

  // ── Step 1: count contests before any call ──────────────────────────
  const countBefore = await prisma.contest.count();
  console.log(`  Contests before: ${countBefore}`);

  // ── Step 2: call the shared function once (range-based ≤7 day scan) ─
  console.log('  → calling runStartupCatchUp() (1st run)...');
  await runStartupCatchUp();
  const countAfter1 = await prisma.contest.count();
  console.log(`  Contests after 1st run: ${countAfter1}`);

  // ── Step 3: call it AGAIN — must not create any new contests ─────────
  console.log('  → calling runStartupCatchUp() (2nd run)...');
  await runStartupCatchUp();
  const countAfter2 = await prisma.contest.count();
  console.log(`  Contests after 2nd run: ${countAfter2}`);

  // ── Assertions ──────────────────────────────────────────────────────
  check(
    '2nd run created no new contests (idempotent)',
    countAfter2 === countAfter1,
    `before=${countAfter1} after=${countAfter2}`,
  );

  // ── Directly verify no duplicate (startTime, stream) pairs exist in DB ──
  const dups = await prisma.$queryRaw`
    SELECT start_time, stream, COUNT(*) AS n
    FROM contests
    GROUP BY start_time, stream
    HAVING COUNT(*) > 1
  `;
  check(
    'No duplicate (startTime, stream) pairs in DB',
    dups.length === 0,
    dups.length > 0 ? JSON.stringify(dups) : '',
  );

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
