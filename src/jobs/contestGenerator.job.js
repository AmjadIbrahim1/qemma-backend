// backend/src/jobs/contestGenerator.job.js
// ✅ NEW: Automated monthly contest creation cron job.
// Runs hourly in Africa/Cairo timezone. Creates contests exactly 7 days before
// their scheduled 5 PM Cairo start time. Dedup prevents duplicates on re-runs.
//
// Schedule: 10 days/month — Hard ×5, Medium ×3, Easy ×2 (all ≤28, no conflicts).
// Each scheduled day → 3 contests (one per stream: Literary/Science-Maths/Science-Biology).

import cron from 'node-cron';
import prisma from '../config/prisma.config.js';
import { CONTEST_STREAMS } from '../modules/auth/subject-stream.map.js';

// ── Hardcoded schedule (10 unique days, all ≤ 28) ────────────────────
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

async function createContestsForDay(targetYear, targetMonth, targetDay, difficulty) {
  const { duration } = DIFFICULTY_CONFIG[difficulty];
  const startTime = cairoTimeToUTC(targetYear, targetMonth, targetDay);
  const monthName = MONTHS_AR[targetMonth - 1];
  const diffLabel = DIFFICULTY_TO_AR[difficulty];
  let created = 0;

  for (const stream of CONTEST_STREAMS) {
    const existing = await prisma.contest.findFirst({
      where: { startTime, stream },
    });
    if (existing) continue;

    const streamLabel = STREAM_TO_AR[stream];
    const title = `مسابقة ${streamLabel} - ${diffLabel} - ${targetDay} ${monthName} ${targetYear}`;

    const contest = await prisma.contest.create({
      data: { title, stream, difficulty, duration, startTime },
    });
    console.log(`✅ contestGenerator: created "${contest.title}" (${contest.id})`);
    created++;
  }

  if (created > 0) {
    console.log(`📅 contestGenerator: ${created} contest(s) created for ${targetDay}/${targetMonth}/${targetYear} (${difficulty})`);
  }
}

// ── Main cron logic ──────────────────────────────────────────────────

async function run() {
  try {
    const { year, month, day } = getCairoDateParts();
    const targetMs = Date.UTC(year, month - 1, day + 7);
    const target = new Date(targetMs);
    const targetDay = target.getUTCDate();
    const targetMonth = target.getUTCMonth() + 1;
    const targetYear = target.getUTCFullYear();

    const difficulty = getDifficultyForDay(targetDay);
    if (!difficulty) return;

    await createContestsForDay(targetYear, targetMonth, targetDay, difficulty);
  } catch (err) {
    console.error('❌ contestGenerator error:', err.message);
  }
}

// ── Register ─────────────────────────────────────────────────────────
// Runs at minute 0 of every hour in Africa/Cairo timezone.
cron.schedule('0 * * * *', run, { timezone: 'Africa/Cairo' });
console.log('⏰ contestGenerator cron registered (hourly, Africa/Cairo)');
