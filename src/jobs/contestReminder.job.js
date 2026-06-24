// backend/src/jobs/contestReminder.job.js
// ✅ NEW (planning_prompts/notification-system.md): Contest reminder notifications.
// A cron job runs every minute, finds contests starting in exactly 48 hours (within a 1-minute
// window), and sends a persistent + real-time notification to every eligible 3rd-year student
// and teacher of the contest's stream. Dedup guard guarantees exactly-once delivery.
//
// ✅ REFACTORED (hybrid strategy): the 1-minute window `run()` is fragile — if the server was
// down during that exact minute, the reminder is permanently lost. Added `runStartupCatchUp()`
// which scans non-test contests with `startTime ∈ (now, now+48h]` and sends any missing
// reminders. The per-user `alreadyNotified()` dedup guarantees exactly-once delivery even if
// the startup scan overlaps with a live cron tick or the server restarts repeatedly.

import cron from 'node-cron';
import prisma from '../config/prisma.config.js';
import notificationsService from '../modules/notifications/notifications.service.js';
import { CONTEST_STREAMS, TEACHER_STREAM_TO_CONTEST_STREAMS } from '../modules/auth/subject-stream.map.js';

// ── Reverse mapping: contest stream → teacher streams that can access it ──────────
// Built from TEACHER_STREAM_TO_CONTEST_STREAMS (teacher→contest). For a given contest stream,
// collect every teacher stream whose allowed contest streams include it.
const CONTEST_STREAM_TO_TEACHER_STREAMS = {};
for (const [teacherStream, contestStreams] of Object.entries(TEACHER_STREAM_TO_CONTEST_STREAMS)) {
  for (const cs of contestStreams) {
    if (!CONTEST_STREAM_TO_TEACHER_STREAMS[cs]) CONTEST_STREAM_TO_TEACHER_STREAMS[cs] = [];
    CONTEST_STREAM_TO_TEACHER_STREAMS[cs].push(teacherStream);
  }
}

// ── Notification payloads (per planning_prompts/notification-system.md §3) ────────
const STREAM_LABELS_AR = {
  'Literary':        'أدبي',
  'Science-Maths':   'علمي رياضة',
  'Science-Biology': 'علمي علوم',
};
const DIFFICULTY_LABELS_AR = { Easy: 'سهل', Medium: 'متوسط', Hard: 'صعب' };

function formatContestDateTime(startTime) {
  const d = new Date(startTime);
  const date = d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return { date, time };
}

function buildStudentNotification(contest) {
  const { date, time } = formatContestDateTime(contest.startTime);
  const streamLabel    = STREAM_LABELS_AR[contest.stream] || contest.stream;
  const diffLabel      = DIFFICULTY_LABELS_AR[contest.difficulty] || contest.difficulty;
  return {
    type:  'contest_reminder',
    title: 'Contest Starting in 48 Hours',
    body:  `${contest.title} (${streamLabel} — ${diffLabel}) starts on ${date} at ${time}. Duration: ${contest.duration} minutes. Make sure you're ready!`,
    data: {
      contestId:  contest.id,
      stream:     contest.stream,
      difficulty: contest.difficulty,
      duration:   contest.duration,
      startTime:  new Date(contest.startTime).toISOString(),
      type:       'student',
    },
  };
}

function buildTeacherNotification(contest) {
  const { date, time } = formatContestDateTime(contest.startTime);
  const streamLabel    = STREAM_LABELS_AR[contest.stream] || contest.stream;
  const diffLabel      = DIFFICULTY_LABELS_AR[contest.difficulty] || contest.difficulty;
  return {
    type:  'contest_reminder',
    title: 'Contest Starting in 48 Hours — Add Questions',
    body:  `${contest.title} (${streamLabel} — ${diffLabel}) starts on ${date} at ${time}. Duration: ${contest.duration} minutes. Make sure all questions are added before it begins.`,
    data: {
      contestId:  contest.id,
      stream:     contest.stream,
      difficulty: contest.difficulty,
      duration:   contest.duration,
      startTime:  new Date(contest.startTime).toISOString(),
      type:       'teacher',
    },
  };
}

// ── Dedup guard: skip if a notification already exists for this user+contest ──────
async function alreadyNotified(userId, contestId) {
  const existing = await prisma.notification.findFirst({
    where: {
      type: 'contest_reminder',
      userId,
      data: { path: ['contestId'], equals: contestId },
    },
  });
  return !!existing;
}

// ── In-memory dedup guard: prevents two concurrent runs from both sending for the same ──
// contest before either's notifications land in the DB (the alreadyNotified() DB check is
// the persistent guard; this Set closes the sub-second race window within one process).
const _reminderProcessing = new Set();

// ✅ NEW (hybrid strategy): extracted the per-contest send logic so both the live cron
// `run()` and the startup catch-up can share it. Per-user alreadyNotified() guarantees
// exactly-once delivery regardless of how many times this is called for the same contest.
async function sendRemindersForContest(contest) {
  // ✅ NEW: in-memory guard — skip if another in-process run is already handling this contest.
  if (_reminderProcessing.has(contest.id)) {
    console.log(`⏭️ contestReminder: "${contest.title}" already being processed in this process — skipping`);
    return;
  }
  _reminderProcessing.add(contest.id);
  try {
    // ── Recipients: 3rd-year students matching the contest stream ──
    const students = await prisma.student.findMany({
      where:  { year: 'third', stream: contest.stream },
      select: { userId: true },
    });

    // ── Recipients: teachers whose allowed streams include the contest stream ──
    const allowedTeacherStreams = CONTEST_STREAM_TO_TEACHER_STREAMS[contest.stream] || [];
    const teachers = allowedTeacherStreams.length > 0
      ? await prisma.teacher.findMany({
          where:  { stream: { in: allowedTeacherStreams } },
          select: { userId: true },
        })
      : [];

    // ── Send student notifications (with dedup) ──
    const studentPayload = buildStudentNotification(contest);
    for (const s of students) {
      if (await alreadyNotified(s.userId, contest.id)) continue;
      await notificationsService.create({ userId: s.userId, ...studentPayload });
    }

    // ── Send teacher notifications (with dedup) ──
    const teacherPayload = buildTeacherNotification(contest);
    for (const t of teachers) {
      if (await alreadyNotified(t.userId, contest.id)) continue;
      await notificationsService.create({ userId: t.userId, ...teacherPayload });
    }

    console.log(`📅 contestReminder: processed "${contest.title}" — ${students.length} students, ${teachers.length} teachers`);
  } finally {
    // ✅ NEW: always release the in-memory lock so the next run can re-evaluate (no-op via DB dedup).
    _reminderProcessing.delete(contest.id);
  }
}

// ── Main cron logic ───────────────────────────────────────────────────────────────
// ✅ REFACTORED (hybrid strategy): the cron `run` now delegates to the SAME range-based
// `runStartupCatchUp` used on startup, so both the cron schedule and the boot catch-up
// share one implementation. The old exact-1-minute-window body is commented out below.
// runStartupCatchUp scans non-test contests in (now, now+48h] and sends any missing
// reminders — per-user alreadyNotified() + the in-memory _reminderProcessing Set guarantee
// no duplicate notifications, even if cron and startup overlap.
async function run() {
  // OLD: exact 1-minute window at the 48h mark (fragile — missed the minute → reminder lost)
  // try {
  //   const now         = new Date();
  //   const windowStart = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  //   const windowEnd   = new Date(windowStart.getTime() + 60 * 1000);
  //
  //   const contests = await prisma.contest.findMany({
  //     where: {
  //       startTime: { gte: windowStart, lt: windowEnd },
  //       isTest:    false,
  //     },
  //   });
  //
  //   if (contests.length === 0) return;
  //
  //   for (const contest of contests) {
  //     await sendRemindersForContest(contest);
  //   }
  // } catch (err) {
  //   console.error('❌ contestReminder error:', err.message);
  // }

  // ✅ NEW: share the range-based catch-up implementation with the startup path.
  await runStartupCatchUp();
}

// ✅ NEW (hybrid strategy): startup catch-up scan.
// Finds non-test contests starting within the next ≤48h and sends any missing reminders.
// Uses a RANGE (now, now+48h] instead of the 1-minute window so contests whose 48h mark
// already passed during downtime are recovered. Per-user alreadyNotified() guarantees
// exactly-once delivery — safe across multiple restarts and overlapping cron ticks.
async function runStartupCatchUp() {
  try {
    const now   = new Date();
    const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Contests starting after now and within the next 48h, excluding dev test contests.
    const contests = await prisma.contest.findMany({
      where: {
        startTime: { gt: now, lte: horizon },
        isTest:    false,
      },
    });

    if (contests.length === 0) {
      console.log('🚀 contestReminder startup catch-up: no upcoming contests in the next 48h');
      return;
    }

    for (const contest of contests) {
      await sendRemindersForContest(contest);
    }
    console.log(`🚀 contestReminder startup catch-up: scanned ${contests.length} upcoming contest(s)`);
  } catch (err) {
    console.error('❌ contestReminder startup catch-up error:', err.message);
  }
}

// ── Register ──────────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', run);
console.log('⏰ contestReminder cron registered (every minute)');

// ✅ NEW: export both so the startup coordinator (jobs/startup.js) can invoke the catch-up
// and the live run independently.
export { run, runStartupCatchUp };
