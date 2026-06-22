// backend/seed-test-contests.js
// ⚠️ DEV-ONLY: Creates 3 always-open test contests (one per stream) for development.
// These are NOT part of production logic or the cron job. Delete after development.
//
// Run:  node seed-test-contests.js
//
// Cleanup (delete all test contests):
//   node -e "import('./src/config/prisma.config.js').then(async m => { const p = m.default; const d = await p.contest.deleteMany({ where: { title: { startsWith: '[TEST]' } } }); console.log('Deleted', d.count, 'test contests'); await p.\$disconnect(); })"
//
// Each contest: difficulty=Hard, startTime=now, duration=99999999 min (~190 years → always active).

import prisma from './src/config/prisma.config.js';

const STREAM_LABELS_AR = {
  'Literary':        'أدبي',
  'Science-Maths':   'علمي رياضة',
  'Science-Biology': 'علمي علوم',
};

const STREAMS = ['Literary', 'Science-Maths', 'Science-Biology'];
const DURATION = 99999999; // minutes (~190 years)
const TITLE_PREFIX = '[TEST]';

async function main() {
  console.log('🌱 Seeding test contests (dev-only)...\n');
  let created = 0;
  let skipped = 0;

  for (const stream of STREAMS) {
    const title = `${TITLE_PREFIX} مسابقة ${STREAM_LABELS_AR[stream]} - صعب`;

    // Dedup: skip if a test contest for this stream already exists
    const existing = await prisma.contest.findFirst({
      where: { title: { startsWith: TITLE_PREFIX }, stream },
    });
    if (existing) {
      console.log(`  ⏭️  Skipped [${stream}] — already exists: "${existing.title}"`);
      skipped++;
      continue;
    }

    const contest = await prisma.contest.create({
      data: {
        title,
        stream,
        difficulty: 'Hard',
        duration: DURATION,
        startTime: new Date(),
        isTest: true,   // ✅ NEW: flags this as a dev test contest — skips time-based checks
      },
    });
    console.log(`  ✅ Created [${stream}] — "${contest.title}" (${contest.id})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.`);
  console.log('⚠️  Remember to delete these after development (see cleanup comment at top of file).');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
