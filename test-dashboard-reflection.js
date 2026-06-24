// backend/test-dashboard-reflection.js
//
// Automated test: verifies that contest participation + scoring is reflected in the
// student dashboard (per-contest score/rank/rating + a global rating derived from the 3 contests).
//
// ──────────────────────────────────────────────────────────────────────────────
// HOW TO RERUN THIS TEST YOURSELF
// ──────────────────────────────────────────────────────────────────────────────
// Prerequisites:
//   1. PostgreSQL running and `backend/.env` configured (DATABASE_URL, JWT_SECRET, MONGODB_URI,
//      ALLOWED_ORIGINS). GROQ_API_KEY / textbooks are NOT required (no AI generation here).
//   2. The backend HTTP server must be running so the test can hit the real endpoints:
//        cd backend && npm run dev            # or: node src/server.js
//      Make sure port 5000 is free first (Get-NetTCPConnection -LocalPort 5000).
//
// Run the test (from the backend/ directory):
//   node test-dashboard-reflection.js
//
// What it does:
//   • Cleans up any previous [DASHTEST] data + dashtest_ users (so runs are idempotent).
//   • Registers 20 real 3rd-grade Literary students via POST /api/auth/register.
//   • Seeds 3 non-test Literary contests (Easy / Medium / Hard) + questions directly via Prisma
//     (there is no HTTP "create contest" endpoint; the teacher question-add endpoint locks 60 min
//      before start, so direct seeding keeps the test fast). Each contest: 1-min duration, already
//      active (startTime in the recent past), 3 MCQs × 4 options, pointValue from difficulty.
//   • Each student participates via the real endpoints: POST /:id/start → POST per-question submit
//     → POST /:id/submit. Answers are mixed (0..3 correct) so ranks/ratings differ per student.
//   • Waits ~70 s for the 1-minute contests to end.
//   • Triggers evaluation the same way the system does: imports the scoring cron job and calls its
//     run() once (idempotent — no-op if the server's own cron already scored them).
//   • Reads each student's dashboard via GET /api/contests/dashboard and asserts:
//       - 3 contest rows, each with a score (finalContestScore), rank, ratingChange, newRating.
//       - a global rating (currentRating = Student.rating) ≥ 0 and equal to one of the rows' ratings.
//
// To wipe the test data afterwards (optional):
//   DELETE FROM contests WHERE title LIKE '[DASHTEST]%';
//   DELETE FROM users  WHERE email LIKE 'dashtest_%';
// (Or just re-run the script — it cleans prior [DASHTEST]/dashtest_ rows at the start.)
// ──────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import axios from 'axios';
import prisma from './src/config/prisma.config.js';
import { run as runScoring } from './src/jobs/contestScoring.job.js';

// ── Config ─────────────────────────────────────────────────────────────────────
const API_BASE = process.env.API_URL || 'http://localhost:5000/api';
const N_STUDENTS        = 20;
const STREAM            = 'Literary';
const DIFFICULTIES      = ['Easy', 'Medium', 'Hard'];
const POINT_VALUE       = { Easy: 1, Medium: 2, Hard: 4 };
const DURATION_MIN      = 1;            // contest length (minutes)
const QUESTIONS_PER_CON = 3;
const OPTIONS_PER_Q     = 4;
const WAIT_MS           = 70_000;        // wait for 1-min contests to end (since scoring needs now > end)
const TITLE_PREFIX      = '[DASHTEST]';
const EMAIL_PREFIX       = 'dashtest_';
const PASSWORD          = 'Test1234';

let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

// ── HTTP helper ─────────────────────────────────────────────────────────────────
async function api(token, method, path, body) {
  const res = await axios({ method, url: API_BASE + path, data: body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    validateStatus: () => true });
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data;
}

// ── Cleanup previous runs ──────────────────────────────────────────────────────
async function cleanup() {
  // Order: contests first (cascade → questions/options/participations/answers), then users (→ students).
  await prisma.contest.deleteMany({ where: { title: { startsWith: TITLE_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

// ── Register 20 Literary 3rd-year students ─────────────────────────────────────
async function registerStudents() {
  const runId = Date.now();
  const students = [];
  for (let i = 0; i < N_STUDENTS; i++) {
    const email = `${EMAIL_PREFIX}${runId}_${i}@example.test`;
    const r = await api(null, 'post', '/auth/register',
      { email, password: PASSWORD, name: `Student ${i}`, role: 'student', division: STREAM, year: 'third' });
    students.push({ idx: i, token: r.data.token, studentId: r.data.user?.student?.id, userId: r.data.user?.id });
  }
  return students;
}

// ── Seed 3 contests + questions via Prisma ─────────────────────────────────────
async function seedContests() {
  const now = Date.now();
  const contests = [];
  for (let k = 0; k < DIFFICULTIES.length; k++) {
    const difficulty = DIFFICULTIES[k];
    // Distinct start times a few seconds in the past → already active; end = start + DURATION_MIN min.
    // Distinct ms guarantees no @@unique([startTime, stream]) collision.
    const startTime = new Date(now - (k + 1) * 1000);
    const contest = await prisma.contest.create({
      data: {
        title: `${TITLE_PREFIX} ${STREAM} ${difficulty}`,
        stream: STREAM,
        difficulty,
        duration: DURATION_MIN,
        startTime,
        isTest: false,
        questionCount: QUESTIONS_PER_CON,
        aiGenerationStatus: 'not_needed', // prevent the AI-generator cron from touching these
      },
    });

    // Create QUESTIONS_PER_CON questions, each with OPTIONS_PER_Q options (exactly 1 correct).
    const questions = [];
    const pointValue = POINT_VALUE[difficulty];
    for (let q = 0; q < QUESTIONS_PER_CON; q++) {
      const question = await prisma.contestQuestion.create({
        data: { contestId: contest.id, text: `Q${q + 1} (${difficulty})`, pointValue, aiGenerated: false },
      });
      let correctOptionId = null, wrongOptionId = null;
      for (let o = 0; o < OPTIONS_PER_Q; o++) {
        const opt = await prisma.contestOption.create({
          data: { contestQuestionId: question.id, text: `Option ${o + 1}`, isCorrect: o === 0 },
        });
        if (o === 0) correctOptionId = opt.id; else if (!wrongOptionId) wrongOptionId = opt.id;
      }
      questions.push({ id: question.id, correctOptionId, wrongOptionId });
    }
    contests.push({ id: contest.id, difficulty, startTime, questions });
  }
  return contests;
}

// ── Every student participates in every contest via the real endpoints ──────────
async function participate(students, contests) {
  let errors = 0;
  for (const contest of contests) {
    await Promise.all(students.map(async (s) => {
      // correctCount in 0..QUESTIONS_PER_CON → 4 distinct score groups (ranks/ratings differ).
      const correctCount = s.idx % (QUESTIONS_PER_CON + 1);
      const start = await api(s.token, 'post', `/contests/${contest.id}/start`);
      const participationId = start.data.participationId;
      for (let q = 0; q < contest.questions.length; q++) {
        const correct = q < correctCount;
        const optId = correct ? contest.questions[q].correctOptionId : contest.questions[q].wrongOptionId;
        await api(s.token, 'post', `/contests/${contest.id}/questions/${contest.questions[q].id}/submit`,
          { selectedOptionId: optId });
      }
      await api(s.token, 'post', `/contests/${contest.id}/submit`);
    })).catch((e) => { errors++; console.error('  participation error:', e.message); });
  }
  return errors;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Verify each student's dashboard ────────────────────────────────────────────
async function verify(students, contests) {
  let studentFail = 0;
  for (const s of students) {
    const dash = await api(s.token, 'get', '/contests/dashboard');
    const d = dash.data;
    const localPass = pass, localFail = fail;
    check(d.stats.totalContests === 3, `student#${s.idx}: totalContests === 3 (got ${d.stats.totalContests})`);
    check(Array.isArray(d.contests) && d.contests.length === 3, `student#${s.idx}: 3 contest rows`);
    for (const row of d.contests) {
      check(row.score != null, `student#${s.idx}: ${row.contestName} has score`);
      check(row.rank != null, `student#${s.idx}: ${row.contestName} has rank`);
      check(row.ratingChange != null && typeof row.ratingChange === 'number',
        `student#${s.idx}: ${row.contestName} has ratingChange`);
      check(row.newRating != null && typeof row.newRating === 'number' && row.newRating >= 0,
        `student#${s.idx}: ${row.contestName} has newRating >= 0`);
    }
    check(typeof d.currentRating === 'number' && d.currentRating >= 0,
      `student#${s.idx}: currentRating is a number >= 0 (got ${d.currentRating})`);
    const newRatings = d.contests.map(r => r.newRating);
    check(newRatings.includes(d.currentRating),
      `student#${s.idx}: currentRating (${d.currentRating}) is derived from the contests' ratings ${JSON.stringify(newRatings)}`);
    if (fail > localFail) studentFail++;
  }
  return studentFail;
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('🧹 Cleaning previous [DASHTEST] data…');
    await cleanup();

    console.log('👤 Registering 20 Literary 3rd-year students…');
    const students = await registerStudents();
    console.log(`   registered ${students.length} students.`);

    console.log('📝 Seeding 3 non-test Literary contests (Easy/Medium/Hard) + questions…');
    const contests = await seedContests();
    console.log(`   created ${contests.length} contests, ${contests.length * QUESTIONS_PER_CON} questions.`);

    console.log('🎮 Simulating participation of all 20 students in all 3 contests…');
    const pErr = await participate(students, contests);
    if (pErr) console.warn(`   ⚠ ${pErr} participation errors (see above).`);

    console.log(`⏳ Waiting ${WAIT_MS / 1000}s for the 1-minute contests to end…`);
    await sleep(WAIT_MS);

    console.log('📊 Running the scoring evaluation (contestScoring job run())…');
    await runScoring();
    // Re-run once in case the server's cron raced and left something unscored.
    const unscored = await prisma.contestParticipation.count({
      where: { contestId: { in: contests.map(c => c.id) }, finalContestScore: null },
    });
    if (unscored > 0) await runScoring();

    console.log('🔍 Verifying dashboards…');
    const studentFail = await verify(students, contests);

    console.log('\n──────── RESULT ────────────────');
    console.log(`Students:   ${N_STUDENTS} (${N_STUDENTS - studentFail} OK, ${studentFail} had failing assertions)`);
    console.log(`Assertions: ${pass} passed, ${fail} failed`);
    console.log('────────────────────────────────');
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    console.error('❌ Test aborted:', err.message);
    console.error(err.stack);
    await prisma.$disconnect();
    process.exit(1);
  }
})();