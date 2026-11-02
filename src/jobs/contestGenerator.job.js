// backend/src/jobs/contestGenerator.job.js
// ✅ NEW: Automated monthly contest creation cron job.
// ✅ CHANGED: now runs every minute (was hourly) in Africa/Cairo timezone. Creates contests
// exactly 7 days before their scheduled 5 PM Cairo start time. Dedup prevents duplicates.
//
// Schedule: 10 days/month — Hard ×5, Medium ×3, Easy ×2 (all ≤28, no conflicts).
// Each scheduled day → 3 contests (one per stream: Literary/Science-Maths/Science-Biology).
//
// ✅ REFACTORED (hybrid strategy): the cron `run()` only catches the *exact* 7-day-prior hour.
// If the server was down during that hour, the contest would never be created. Added
// `runStartupCatchUp()` which scans the next ≤7 days and creates any scheduled contest that
// is missing (dedup `findFirst` on startTime+stream guarantees no duplicates even if the
// startup scan overlaps with a cron tick or the server restarts multiple times).

import cron from 'node-cron';
import prisma from '../config/prisma.config.js';
// ✅ CHANGED: no longer needed — each day now has a single hardcoded stream (no loop over streams).
// import { CONTEST_STREAMS } from '../modules/auth/subject-stream.map.js';

// ── Hardcoded schedule (10 unique days, all ≤ 28) ────────────────────
// ✅ CHANGED: each day now maps to exactly ONE contest with a single predefined stream
// (was: difficulty → [days], creating 3 contests/day across all streams).
// 10 contests/month, one per scheduled day, each belonging to exactly one stream.
// const CONTEST_SCHEDULE = {
//   Hard:   [3,  8,  13, 18, 23],
//   Medium: [6,  16, 26],
//   Easy:   [11, 21],
// };
//
// function getDifficultyForDay(day) {
//   for (const [difficulty, days] of Object.entries(CONTEST_SCHEDULE)) {
//     if (days.includes(day)) return difficulty;
//   }
//   return null;
// }

// ✅ NEW: day → { difficulty, stream } — hardcodes the single stream per generated contest,
// mirroring the day-hardcoding approach. Streams are distributed across the 10 days.
const CONTEST_SCHEDULE = {
  3:  { difficulty: 'Hard',   stream: 'Literary' },
  6:  { difficulty: 'Medium', stream: 'Science-Maths' },
  8:  { difficulty: 'Hard',   stream: 'Science-Biology' },
  11: { difficulty: 'Easy',   stream: 'Literary' },
  13: { difficulty: 'Hard',   stream: 'Science-Maths' },
  16: { difficulty: 'Medium', stream: 'Science-Biology' },
  18: { difficulty: 'Hard',   stream: 'Literary' },
  21: { difficulty: 'Easy',   stream: 'Science-Maths' },
  23: { difficulty: 'Hard',   stream: 'Science-Biology' },
  26: { difficulty: 'Medium', stream: 'Literary' },
};

// ✅ NEW: returns { difficulty, stream } for a day, or null if no contest is scheduled.
function getContestForDay(day) {
  return CONTEST_SCHEDULE[day] || null;
}

// ── Difficulty → fixed per-contest values ────────────────────────────
const DIFFICULTY_CONFIG = {
  Easy:   { duration: 30 },
  Medium: { duration: 90 },
  Hard:   { duration: 150 },
};

// ── Arabic label maps ────────────────────────────────────────────────
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

// ── Timezone helpers (Africa/Cairo via Intl, no extra deps) ──────────

function getCairoDateParts() {
  const str = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
  }).format(new Date());
  const [year, month, day] = str.split('-').map(Number);
  return { year, month, day };
}

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

// ── Contest creation ─────────────────────────────────────────────────

async function createContestsForDay(targetYear, targetMonth, targetDay, difficulty, stream) {
  const { duration } = DIFFICULTY_CONFIG[difficulty];
  const startTime = cairoTimeToUTC(targetYear, targetMonth, targetDay);
  const monthName = MONTHS_AR[targetMonth - 1];
  const diffLabel = DIFFICULTY_TO_AR[difficulty];
  let created = 0;

  // ✅ CHANGED: each day maps to exactly one predefined stream — no loop over CONTEST_STREAMS.
  // for (const stream of CONTEST_STREAMS) {
    const existing = await prisma.contest.findFirst({
      where: { startTime, stream },
    });
    // ✅ CHANGED: `continue` → `return` (no loop) — skip if this day's contest already exists.
    // if (existing) continue;
    if (existing) return;

    const streamLabel = STREAM_TO_AR[stream];
    const title = `مسابقة ${streamLabel} - ${diffLabel} - ${targetDay} ${monthName} ${targetYear}`;

    // ✅ NEW: catch P2002 (unique violation on [startTime, stream]) as a no-op — this is the
    // DB-level idempotency backstop for when cron and startup catch-up race on the same row.
    try {
      const contest = await prisma.contest.create({
        data: { title, stream, difficulty, duration, startTime },
      });
      console.log(`✅ contestGenerator: created "${contest.title}" (${contest.id})`);
      created++;
    } catch (err) {
      if (err.code === 'P2002') {
        // another concurrent run created this contest first — safe no-op
        // ✅ CHANGED: `continue` → `return` (no loop).
        // continue;
        return;
      }
      throw err;
    }
  // }  // ✅ CHANGED: end of removed for-loop over CONTEST_STREAMS

  if (created > 0) {
    console.log(`📅 contestGenerator: ${created} contest(s) created for ${targetDay}/${targetMonth}/${targetYear} (${difficulty})`);
  }
}

// ── Main cron logic ──────────────────────────────────────────────────

// ✅ REFACTORED (hybrid strategy): the cron `run` now delegates to the SAME range-based
// `runStartupCatchUp` used on startup, so both the cron schedule and the boot catch-up
// share one implementation. The old exact-7-day-prior body is commented out below.
// runStartupCatchUp scans the next ≤7 days and creates any missing contests — the per-
// contest findFirst dedup + the DB @@unique([startTime, stream]) constraint guarantee
// no duplicate is ever created, even if cron and startup overlap.
async function run() {
  // OLD: exact 7-day-prior hourly logic (fragile — missed the hour → contest never created)
  // try {
  //   const { year, month, day } = getCairoDateParts();
  //   const targetMs = Date.UTC(year, month - 1, day + 7);
  //   const target = new Date(targetMs);
  //   const targetDay = target.getUTCDate();
  //   const targetMonth = target.getUTCMonth() + 1;
  //   const targetYear = target.getUTCFullYear();
  //
  //   const difficulty = getDifficultyForDay(targetDay);
  //   if (!difficulty) return;
  //
  //   await createContestsForDay(targetYear, targetMonth, targetDay, difficulty);
  // } catch (err) {
  //   console.error('❌ contestGenerator error:', err.message);
  // }

  // ✅ NEW: share the range-based catch-up implementation with the startup path.
  await runStartupCatchUp();
}

// ✅ NEW (hybrid strategy): startup catch-up scan.
// Scans every day in the next ≤7 days (in Cairo time). For each scheduled day, creates
// any missing contests. The per-contest dedup `findFirst({ startTime, stream })` inside
// createContestsForDay() guarantees idempotency — safe to call on every boot, and safe
// even if the cron tick fires simultaneously.
async function runStartupCatchUp() {
  try {
    const { year, month, day } = getCairoDateParts();
    let createdTotal = 0;

    // Scan each of the next 7 days (offset 0..7) — covers the full creation lead window.
    for (let offset = 0; offset <= 7; offset++) {
      const targetMs = Date.UTC(year, month - 1, day + offset);
      const target = new Date(targetMs);
      const targetDay = target.getUTCDate();
      const targetMonth = target.getUTCMonth() + 1;
      const targetYear = target.getUTCFullYear();

      // ✅ CHANGED: use getContestForDay (returns { difficulty, stream }) instead of getDifficultyForDay.
      const contestCfg = getContestForDay(targetDay);
      if (!contestCfg) continue;

      // createContestsForDay is dedup-guarded → re-running on an already-created day is a no-op.
      // ✅ CHANGED: pass the single predefined stream for this day.
      await createContestsForDay(targetYear, targetMonth, targetDay, contestCfg.difficulty, contestCfg.stream);
      createdTotal++;
    }

    if (createdTotal > 0) {
      console.log(`🚀 contestGenerator startup catch-up: scanned 8 day(s), ${createdTotal} scheduled day(s) checked`);
    } else {
      console.log('🚀 contestGenerator startup catch-up: no scheduled days in the next 7 days');
    }
  } catch (err) {
    console.error('❌ contestGenerator startup catch-up error:', err.message);
  }
}

// ── Register ─────────────────────────────────────────────────────────
// ✅ CHANGED: was hourly '0 * * * *' — now every minute so contests are created promptly.
// Runs every minute in Africa/Cairo timezone.
cron.schedule('* * * * *', run, { timezone: 'Africa/Cairo' });
console.log('⏰ contestGenerator cron registered (every minute, Africa/Cairo)');

// ✅ NEW: export both so the startup coordinator (jobs/startup.js) can invoke the catch-up
// and the live run independently.
export { run, runStartupCatchUp };
