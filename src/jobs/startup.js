// backend/src/jobs/startup.js
// ✅ NEW (hybrid cron strategy): one-time startup catch-up coordinator.
//
// On every server boot, runs the catch-up scans for the four contest jobs so that any
// events missed during downtime are recovered immediately:
//   - contestGenerator        : create any scheduled contests missing in the next ≤7 days
//   - contestReminder         : send reminders for upcoming contests in the next ≤48h
//   - contestScoring          : score any ended-but-unscored contests
//   - contestQuestionGenerator: generate missing questions within the 60-min pre-start window
//
// Each job's catch-up is idempotent (dedup guards in the job files), so this is safe to
// run on every boot even if the server restarts multiple times in quick succession, and
// even if a cron tick fires during the catch-up.
//
// The module-level `started` flag guards against double execution if this module is
// somehow imported twice in the same process.

import { runStartupCatchUp as generatorCatchUp }        from './contestGenerator.job.js';
import { runStartupCatchUp as reminderCatchUp }         from './contestReminder.job.js';
import { run as scoringCatchUp }                        from './contestScoring.job.js';
// ✅ NEW (AI question generation): 4th catch-up — generate missing contest questions
// via Groq within the 60-minute pre-start window.
import { runStartupCatchUp as questionGeneratorCatchUp } from './contestQuestionGenerator.job.js';
let started = false;

// ✅ NEW: runs all three catch-up scans once. Called from server.js after Mongoose connects.
// Errors are isolated per job — a failure in one catch-up does not block the others.
async function runStartupCatchUps() {
  if (started) {
    console.log('🚀 jobs/startup: catch-ups already executed in this process — skipping');
    return;
  }
  started = true;

  console.log('🚀 jobs/startup: running startup catch-up scans...');

  // Run sequentially (not in parallel) to avoid thundering-herd DB load on boot and to
  // keep the logs readable. Each catch-up is internally try/caught, so a throw here is
  // only a safety net.
  try {
    await generatorCatchUp();
  } catch (err) {
    console.error('❌ jobs/startup: contestGenerator catch-up failed:', err.message);
  }

  try {
    await reminderCatchUp();
  } catch (err) {
    console.error('❌ jobs/startup: contestReminder catch-up failed:', err.message);
  }

  try {
    await scoringCatchUp();
  } catch (err) {
    console.error('❌ jobs/startup: contestScoring catch-up failed:', err.message);
  }

  try {
    await questionGeneratorCatchUp();
  } catch (err) {
    console.error('❌ jobs/startup: contestQuestionGenerator catch-up failed:', err.message);
  }

  console.log('🚀 jobs/startup: catch-up scans complete');
}

export { runStartupCatchUps };
