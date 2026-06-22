// backend/src/jobs/contestReminder.job.js
// ✅ NEW (planning_prompts/notification-system.md): Contest reminder notifications.
// A cron job runs every minute, finds contests starting in exactly 48 hours (within a 1-minute
// window), and sends a persistent + real-time notification to every eligible 3rd-year student
// and teacher of the contest's stream. Dedup guard guarantees exactly-once delivery.

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

// ── Main cron logic ───────────────────────────────────────────────────────────────
async function run() {
  try {
    const now         = new Date();
    const windowStart = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const windowEnd   = new Date(windowStart.getTime() + 60 * 1000);

    // Find contests starting in the 48h±1min window. Exclude dev test contests.
    const contests = await prisma.contest.findMany({
      where: {
        startTime: { gte: windowStart, lt: windowEnd },
        isTest:    false,
      },
    });

    if (contests.length === 0) return;

    for (const contest of contests) {
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
    }
  } catch (err) {
    console.error('❌ contestReminder error:', err.message);
  }
}

// ── Register ──────────────────────────────────────────────────────────────────────
cron.schedule('* * * * *', run);
console.log('⏰ contestReminder cron registered (every minute)');
