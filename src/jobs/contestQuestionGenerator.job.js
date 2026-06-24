// backend/src/jobs/contestQuestionGenerator.job.js
// ✅ NEW (AI contest question generation): 4th contest cron job.
//
// When a non-test contest is within 60 minutes of its start time AND is missing questions
// (real count < required for its difficulty), this job generates the remaining questions
// via the Groq API (Arabic + English textbooks). Teacher question editing is locked at
// the same 60-minute mark (see contests.service.js) so there's no race between the
// teacher and the generator.
//
// Required counts: Easy=10, Medium=30, Hard=50. Split ~50/50 Arabic/English (Arabic gets
// the extra when the gap is odd). Only the gap is generated.
//
// Hybrid strategy (mirrors the other 3 contest jobs): the cron `run()` delegates to
// `runStartupCatchUp()` so both the scheduled cron and the boot catch-up share one
// implementation. Idempotency layers (defense in depth):
//   - App-level : aiGenerationStatus ∈ {completed, not_needed, failed} → excluded from query
//   - In-memory : _generationInProgress Set → prevents cron + startup scoring the same
//                 contest concurrently within one process (released in `finally`).
// Excludes isTest=true (dev contests) — consistent with the other jobs.

import cron from 'node-cron';
import prisma from '../config/prisma.config.js';
import { generateForContest } from '../modules/ai/contest-question-generator/generator.service.js';

const WINDOW_MS = 60 * 60 * 1000; // 60 minutes before start

// ── In-memory guard: contests currently being generated in this process ──────────
// Prevents the cron tick and the startup catch-up from generating for the same contest
// concurrently (which would create duplicate questions). The persistent guard is
// aiGenerationStatus (set once generation completes/fails/skips).
const _generationInProgress = new Set();

// ── Per-contest generation with the in-memory guard ──────────────────────────────
async function generateForContestGuarded(contest) {
  if (_generationInProgress.has(contest.id)) {
    console.log(`⏭️ contestQuestionGenerator: "${contest.title}" already being generated — skipping`);
    return;
  }
  _generationInProgress.add(contest.id);
  try {
    const result = await generateForContest(contest);
    if (result?.inserted != null) {
      console.log(`🤖 contestQuestionGenerator: "${contest.title}" → ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error(`❌ contestQuestionGenerator: failed for "${contest.title}":`, err.message);
  } finally {
    _generationInProgress.delete(contest.id);
  }
}

// ── Main cron logic ───────────────────────────────────────────────────────────────
// ✅ Hybrid: the cron `run` delegates to the SAME range-based `runStartupCatchUp` used
// on startup, so both share one implementation. The scan window is
//   [now, now + 60min)  → contests whose 60-min pre-start mark has arrived but which
//   have not started yet. We query startTime ∈ [now − 0, now + 60min] i.e. the contest
//   starts within the next 60 minutes (and hasn't started yet, since now < startTime).
async function run() {
  await runStartupCatchUp();
}

// ✅ NEW (hybrid strategy): startup catch-up scan.
// Finds non-test contests starting within the next ≤60min that the generator has not
// yet processed (aiGenerationStatus IS NULL) and generates the missing questions.
// Safe across multiple restarts + overlapping cron ticks via the status field + Set.
async function runStartupCatchUp() {
  try {
    const now      = new Date();
    const horizon  = new Date(now.getTime() + WINDOW_MS);

    // Contests starting within (now, now+60min] that haven't been evaluated yet.
    // Excludes dev test contests and any already-terminal status.
    const contests = await prisma.contest.findMany({
      where: {
        startTime:           { gt: now, lte: horizon },
        isTest:              false,
        aiGenerationStatus:  null,
      },
    });

    if (contests.length === 0) {
      console.log('🚀 contestQuestionGenerator catch-up: no contests in the 60-min generation window');
      return;
    }

    for (const contest of contests) {
      await generateForContestGuarded(contest);
    }
    console.log(`🚀 contestQuestionGenerator catch-up: scanned ${contests.length} contest(s)`);
  } catch (err) {
    console.error('❌ contestQuestionGenerator catch-up error:', err.message);
  }
}

// ── Register ─────────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', run);
console.log('⏰ contestQuestionGenerator cron registered (every minute)');

// ✅ NEW: export both so the startup coordinator (jobs/startup.js) can invoke the catch-up
// and the live run independently.
export { run, runStartupCatchUp };
