import cron from 'node-cron';
import prisma from '../config/prisma.config.js';

const CONTEST_DURATION_MINUTES = 2;
const LEAD_TIME_MINUTES = 1;   // contest starts 1 minute after creation

async function ensureTestContest() {
  try {
    const now = new Date();

    const existing = await prisma.contest.findMany({
      where: { isTest: true },
      select: { id: true, startTime: true, duration: true },
    });

    const hasNonEnded = existing.some(c => {
      const end = new Date(new Date(c.startTime).getTime() + c.duration * 60 * 1000);
      return now < end;
    });

    if (hasNonEnded) return;

    const startTime = new Date(now.getTime() + LEAD_TIME_MINUTES * 60 * 1000);

    const y = startTime.getFullYear();
    const m = String(startTime.getMonth() + 1).padStart(2, '0');
    const d = String(startTime.getDate()).padStart(2, '0');
    const hh = String(startTime.getHours()).padStart(2, '0');
    const mm = String(startTime.getMinutes()).padStart(2, '0');
    const title = `🧪 Golden Competition - Test ${y}-${m}-${d} ${hh}:${mm}`;

    await prisma.contest.create({
      data: {
        title,
        stream: 'Literary',
        difficulty: 'Easy',
        duration: CONTEST_DURATION_MINUTES,
        startTime,
        isTest: true,
      },
    });

    console.log(`🧪 testContestGenerator: created "${title}" (starts in ${LEAD_TIME_MINUTES} min, lasts ${CONTEST_DURATION_MINUTES} min)`);
  } catch (err) {
    if (err.code === 'P2002') return;
    console.error('❌ testContestGenerator error:', err.message);
  }
}

async function run() {
  await ensureTestContest();
}

cron.schedule('* * * * *', run);
console.log('⏰ testContestGenerator cron registered (every minute)');

export { run, ensureTestContest };
