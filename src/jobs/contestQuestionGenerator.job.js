// backend/src/jobs/contestQuestionGenerator.job.js
// ✅ NEW (AI contest question generation): 4th contest cron job.
//
// When ANY contest (including test contests) is within 60 minutes of its start time AND
// has fewer than 50 questions, this job generates the remaining questions via the Groq API
// (uses GROQ_API_KEY via the shared groq client). Teacher question editing is
// locked at the same 60-minute mark (see contests.service.js) so there's no race between
// the teacher and the generator.
//
// Target: 50 questions for ALL contests regardless of difficulty or isTest flag.
// Split ~50/50 Arabic/English (Arabic gets the extra when the gap is odd). Only the gap
// is generated.
//
// Hybrid strategy (mirrors the other 3 contest jobs): the cron `run()` delegates to
// `runStartupCatchUp()` so both the scheduled cron and the boot catch-up share one
// implementation. Idempotency layers (defense in depth):
//   - App-level : aiGenerationStatus ∈ {completed, not_needed, failed} → excluded from query
//   - In-memory : _generationInProgress Set → prevents cron + startup scoring the same
//                 contest concurrently within one process (released in `finally`).
// Includes BOTH normal contests and test contests (isTest=true).

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
//   [now − 5min, now + 60min]  → contests whose 60-min pre-start mark has arrived,
//   including contests that started within the last 5 minutes (catch any edge case
//   where the cron was down or the contest just started).
//
// ✅ CHANGED: now also retries contests with aiGenerationStatus 'failed' or 'partial'
//   (with a 5-minute cooldown so we don't hammer a broken API key every minute).
async function run() {
  await runStartupCatchUp();
}

// ✅ NEW (hybrid strategy): startup catch-up scan.
// Finds ALL contests (including test contests) starting within [now−5min, now+60min] that
// either:
//   - have not yet been processed (aiGenerationStatus IS NULL), OR
//   - were previously marked 'failed' or 'partial' and haven't been retried in ≥5 minutes
//
// This ensures the generator retries transient failures automatically and doesn't miss
// contests whose start time has arrived. Safe across multiple restarts + overlapping
// cron ticks via the status field + Set.
async function runStartupCatchUp() {
  try {
    const now         = new Date();
    const cutoff      = new Date(now.getTime() - 5 * 60 * 1000);  // 5 minutes ago (window + cooldown)
    const horizon     = new Date(now.getTime() + WINDOW_MS);

    // Contests either unprocessed (null), or pending/failed/partial with retry cooldown elapsed.
    // 'pending' is included so that if the server crashed mid‑generation the contest is not
    // stuck forever — pending records with aiGeneratedAt older than the cooldown are retried.
    // Also include records with null aiGeneratedAt (edge-case data state).
    const contests = await prisma.contest.findMany({
      where: {
        startTime: { gte: cutoff, lte: horizon },
        OR: [
          { aiGenerationStatus: null },
          {
            aiGenerationStatus: { in: ['pending', 'failed', 'partial'] },
            OR: [
              { aiGeneratedAt: { lt: cutoff } },
              { aiGeneratedAt: null },
            ],
          },
        ],
      },
    });

    if (contests.length === 0) {
      console.log('🚀 contestQuestionGenerator catch-up: no contests in the generation window');
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
