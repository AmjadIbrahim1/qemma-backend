// backend/src/modules/contests/contests.service.js
// ✅ NEW (contests feature): Contest service — teacher question management + student participation.
// Mirrors the exams module layering (service class → Prisma). Reuses _getTeacher/_getStudent pattern
// from exams.service.js. Stream authorization uses subject-stream.map.js helpers.

import prisma from '../../config/prisma.config.js';
import { canTeacherAddToContest, getAllowedContestStreams } from '../auth/subject-stream.map.js';

// Difficulty values allowed (per scoring-system.md). Multiplier used by rating algorithm (out of scope here).
const VALID_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
// Contest streams (per planning_prompts: 3 values).
const CONTEST_STREAMS = ['Literary', 'Science-Maths', 'Science-Biology'];
// ✅ NEW: auto-assigned pointValue per contest difficulty for teacher-added questions.
// Matches the AI generator's DEFAULT_POINT_VALUE so all questions in a contest share one mark scheme.
const TEACHER_POINT_VALUE = { Easy: 1, Medium: 2, Hard: 4 };

class ContestsService {

  // ── helpers (mirror exams.service.js) ──────────────────────────
  async _getTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher profile not found'), { statusCode: 404 });
    return teacher;
  }

  async _getStudent(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('Student profile not found'), { statusCode: 404 });
    return student;
  }

  // Contest end time = startTime + duration minutes
  _contestEndTime(contest) {
    return new Date(new Date(contest.startTime).getTime() + contest.duration * 60 * 1000);
  }

  // ✅ NEW: Public — return the next upcoming or currently active contest (for the landing page).
  // No auth required. Returns the earliest contest with startTime > now (upcoming), or if none,
  // the earliest contest still within its active window. Returns null if no contest is found.
  async getNextContest() {
    const now = new Date();
    const contests = await prisma.contest.findMany({
      where:   { isTest: false },
      include: { _count: { select: { questions: true, participations: true } } },
      orderBy: { startTime: 'asc' },
    });

    // Prefer the next upcoming contest; fall back to the earliest active one.
    const upcoming = contests.filter(c => new Date(c.startTime) > now);
    const active   = contests.filter(c => {
      const end = this._contestEndTime(c);
      return now >= new Date(c.startTime) && now < end;
    });

    const chosen = upcoming.length > 0 ? upcoming[0] : (active.length > 0 ? active[0] : null);
    if (!chosen) return null;
    return this._formatContestSummary(chosen, now);
  }

  // ── FEATURE 1: TEACHER — question management ───────────────────

  // List contests the teacher is authorized to add questions to (upcoming AND active).
  // ✅ CHANGED: now returns ALL contests (no stream filter). The `canManage` flag per contest
  //    indicates whether the teacher can add questions (stream match via canTeacherAddToContest).
  //    For parents (no teacher profile), canManage=false always — supports the read-only view.
  async getTeacherContests(userId) {
    // ✅ NEW: look up the teacher profile optionally — parents don't have one (read-only view).
    let teacherStream = null;
    try {
      const teacher = await this._getTeacher(userId);
      teacherStream = teacher.stream;
    } catch (_) { /* not a teacher — read-only (parent) */ }

    const contests = await prisma.contest.findMany({
      include: { _count: { select: { questions: true, participations: true } } },
      orderBy: { startTime: 'asc' },
    });

    const now = new Date();
    const notEnded = contests.filter(c => now < this._contestEndTime(c));
    return notEnded.map(c => ({
      ...this._formatContestSummary(c, now),
      canManage: canTeacherAddToContest(teacherStream, c.stream),
    }));
  }

  // ✅ NEW: List ended contests (history). Returns ALL ended contests (no stream filter).
  // ✅ CHANGED: canManage flag per contest (same as getTeacherContests). Parents get canManage=false.
  async getTeacherPastContests(userId) {
    let teacherStream = null;
    try {
      const teacher = await this._getTeacher(userId);
      teacherStream = teacher.stream;
    } catch (_) { /* not a teacher — read-only (parent) */ }

    const contests = await prisma.contest.findMany({
      include: { _count: { select: { questions: true, participations: true } } },
    });

    const now = new Date();
    const ended = contests
      .filter(c => now > this._contestEndTime(c))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return ended.map(c => ({
      ...this._formatContestSummary(c, now),
      canManage: canTeacherAddToContest(teacherStream, c.stream),
    }));
  }

  // Get one contest (teacher view: includes questions with options incl. isCorrect).
  async getContestForTeacher(contestId, userId) {
    const teacher = await this._getTeacher(userId);
    const contest = await prisma.contest.findUnique({
      where:   { id: contestId },
      // ✅ CHANGED: include teacher→user.name on each question for attribution display.
      include: { questions: { orderBy: { createdAt: 'asc' }, include: { options: true, teacher: { include: { user: { select: { name: true } } } }, _count: { select: { answers: true } } } } },
    });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Authorization: teacher's stream must allow this contest's stream
    if (!canTeacherAddToContest(teacher.stream, contest.stream))
      throw Object.assign(new Error('You are not authorized to access this contest (stream mismatch)'), { statusCode: 403 });

    const now = new Date();
    // ✅ NEW: pass current teacher id so per-question canDelete is computed (own + non-AI only).
    return this._formatContestDetail(contest, now, { includeCorrect: true, teacherView: true, currentTeacherId: teacher.id });
  }

  // List questions for a contest (teacher view, with correct options).
  async getContestQuestions(contestId, userId) {
    const contest = await this.getContestForTeacher(contestId, userId);
    return contest.questions;
  }

  // Add one MCQ question to a contest.
  // Payload: { text, options: [{ text, isCorrect }] } — pointValue is auto-assigned from contest difficulty.
  async addContestQuestion(contestId, userId, data) {
    const teacher = await this._getTeacher(userId);
    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Authorization
    if (!canTeacherAddToContest(teacher.stream, contest.stream))
      throw Object.assign(new Error('You are not authorized to add questions to this contest (stream mismatch)'), { statusCode: 403 });

    // Lock: questions cannot be added once the contest has started
    // ✅ CHANGED: skip time check for dev test contests (isTest=true)
    // if (new Date() >= new Date(contest.startTime))
    //   throw Object.assign(new Error('Cannot add questions after the contest has started'), { statusCode: 403 });
    // ✅ NEW (AI question generation): lock question editing 60 minutes before start so the
    // AI generator job can safely fill the remaining gap without racing the teacher.
    if (!contest.isTest && new Date() >= new Date(new Date(contest.startTime).getTime() - 60 * 60 * 1000))
      throw Object.assign(new Error('Question adding is locked 60 minutes before the contest starts'), { statusCode: 403 });
    // ✅ NEW: test contests are always available except after their termination time.
    if (contest.isTest && new Date() > this._contestEndTime(contest))
      throw Object.assign(new Error('This contest has ended'), { statusCode: 403 });

    // Validate payload
    const { text, options } = data;
    if (!text || !text.trim()) throw Object.assign(new Error('Question text is required'), { statusCode: 400 });
    // ✅ CHANGED: pointValue is no longer chosen by the teacher — auto-assigned from contest difficulty.
    const pointValue = TEACHER_POINT_VALUE[contest.difficulty];
    if (!pointValue) throw Object.assign(new Error(`Unknown contest difficulty: ${contest.difficulty}`), { statusCode: 400 });
    if (!Array.isArray(options) || options.length < 2)
      throw Object.assign(new Error('At least 2 options are required'), { statusCode: 400 });
    // ✅ NEW: limit teacher questions to 2-4 options (matches MCQ convention).
    if (options.length > 4)
      throw Object.assign(new Error('A question can have at most 4 options'), { statusCode: 400 });

    const correctCount = options.filter(o => o.isCorrect === true).length;
    if (correctCount !== 1)
      throw Object.assign(new Error('Exactly one option must be marked isCorrect'), { statusCode: 400 });
    if (options.some(o => !o.text || !o.text.trim()))
      throw Object.assign(new Error('All options must have non-empty text'), { statusCode: 400 });

    // Transactional create: ContestQuestion + ContestOption[] (mirrors exams.service.js createExam)
    const question = await prisma.$transaction(async (tx) => {
      const newQ = await tx.contestQuestion.create({
        // ✅ NEW: store teacherId for attribution + delete-own-only. pointValue auto from difficulty.
        data: { contestId, text: text.trim(), pointValue, teacherId: teacher.id, aiGenerated: false },
      });
      await tx.contestOption.createMany({
        data: options.map(o => ({
          contestQuestionId: newQ.id,
          text:              o.text.trim(),
          isCorrect:         Boolean(o.isCorrect),
        })),
      });
      return tx.contestQuestion.findUnique({
        where:   { id: newQ.id },
        include: { options: true, teacher: { include: { user: { select: { name: true } } } } },
      });
    });

    // Update denormalized questionCount on the contest
    await prisma.contest.update({
      where: { id: contestId },
      data:  { questionCount: { increment: 1 } },
    });

    return this._formatQuestion(question, { includeCorrect: true, teacherView: true, currentTeacherId: teacher.id });
  }

  // Delete a question from a contest (only before the contest starts).
  async deleteContestQuestion(contestId, questionId, userId) {
    const teacher = await this._getTeacher(userId);
    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    if (!canTeacherAddToContest(teacher.stream, contest.stream))
      throw Object.assign(new Error('You are not authorized to modify this contest (stream mismatch)'), { statusCode: 403 });

    // ✅ CHANGED: skip time check for dev test contests (isTest=true)
    // if (new Date() >= new Date(contest.startTime))
    //   throw Object.assign(new Error('Cannot delete questions after the contest has started'), { statusCode: 403 });
    // ✅ NEW (AI question generation): lock question editing 60 minutes before start (same as add).
    if (!contest.isTest && new Date() >= new Date(new Date(contest.startTime).getTime() - 60 * 60 * 1000))
      throw Object.assign(new Error('Question editing is locked 60 minutes before the contest starts'), { statusCode: 403 });
    // ✅ NEW: test contests are always available except after their termination time.
    if (contest.isTest && new Date() > this._contestEndTime(contest))
      throw Object.assign(new Error('This contest has ended'), { statusCode: 403 });

    const question = await prisma.contestQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.contestId !== contestId)
      throw Object.assign(new Error('Question not found in this contest'), { statusCode: 404 });

    // ✅ NEW: delete permissions — a teacher may delete ONLY their own questions, never AI-generated
    // questions and never questions authored by another teacher.
    if (question.aiGenerated)
      throw Object.assign(new Error('Cannot delete AI-generated questions'), { statusCode: 403 });
    if (!question.teacherId || question.teacherId !== teacher.id)
      throw Object.assign(new Error('You can only delete your own questions'), { statusCode: 403 });

    await prisma.contestQuestion.delete({ where: { id: questionId } });

    await prisma.contest.update({
      where: { id: contestId },
      data:  { questionCount: { decrement: 1 } },
    });

    return { message: 'Question deleted successfully' };
  }

  // ── FEATURE 2: STUDENT — participation ─────────────────────────

  // List contests the student can see (upcoming AND active).
  // ✅ CHANGED: ALL students see ALL contests (no year/stream filter). Participation is still
  //    restricted to 3rd-year + stream match (enforced in startContest). The `eligible` flag
  //    tells the frontend whether to show the participation button.
  async getAvailableContests(userId) {
    const student = await this._getStudent(userId);

    const now = new Date();
    const contests = await prisma.contest.findMany({
      include: { _count: { select: { questions: true, participations: true } } },
      orderBy: { startTime: 'asc' },
    });

    // Filter to not-ended contests (upcoming + active, excludes ended)
    const active = contests.filter(c => {
      const end = this._contestEndTime(c);
      return now < end;
    });

    // Attach the student's existing participation (if any) so the UI can offer "resume"
    const contestIds = active.map(c => c.id);
    const participations = await prisma.contestParticipation.findMany({
      where:  { contestId: { in: contestIds }, studentId: student.id },
      select: { contestId: true, submittedAt: true },
    });
    const pMap = {};
    participations.forEach(p => { pMap[p.contestId] = p; });

    return active.map(c => {
      const p = pMap[c.id] || null;
      // ✅ NEW: eligible = 3rd-year AND stream match (participation still enforced in startContest).
      const eligible = student.year === 'third' && student.stream === c.stream;
      return {
        ...this._formatContestSummary(c, now),
        myParticipation: p,
        hasSubmitted:    !!p?.submittedAt,
        eligible,
      };
    });
  }

  // ✅ NEW: Student contest dashboard — aggregate stats + rating history + per-contest rows.
  // All data is derived from existing participation/answer/scoring fields (no schema change).
  // Used by the frontend page at /student/contests/dashboard (student-dashboard-feature-frontend.md).
  async getDashboard(userId) {
    const student = await this._getStudent(userId);

    // Pull every participation with its contest (+ counts) and answers (to count correct answers)
    const participations = await prisma.contestParticipation.findMany({
      where:   { studentId: student.id },
      include: {
        contest: { include: { _count: { select: { questions: true, participations: true } } } },
        answers: { select: { isCorrect: true } },
      },
    });

    // Chronological (oldest first) — for the rating progression chart
    const chrono = [...participations].sort(
      (a, b) => new Date(a.contest.startTime) - new Date(b.contest.startTime),
    );
    // Newest first — for the history table
    const rows = [...participations]
      .sort((a, b) => new Date(b.contest.startTime) - new Date(a.contest.startTime))
      .map(p => this._formatDashboardRow(p));

    // Aggregate stats (rank fields only exist on scored participations)
    const totalContests = participations.length;
    const totalSolved   = participations.reduce(
      (sum, p) => sum + p.answers.filter(a => a.isCorrect).length, 0,
    );
    const ranked  = participations.filter(p => p.actualRank != null);
    const avgRank = ranked.length
      ? Math.round(ranked.reduce((s, p) => s + p.actualRank, 0) / ranked.length)
      : 0;
    const bestRank = ranked.length ? Math.min(...ranked.map(p => p.actualRank)) : 0;

    // Rating history (Codeforces-style progression) — only scored participations have ratingAfter.
    // Prepend the earliest ratingBefore as the "starting" point so the line shows the before→after jump.
    const scored = chrono.filter(p => p.ratingAfter != null);
    let ratingHistory;
    if (scored.length === 0) {
      // No scored contests yet — flat point at the current rating so the chart still renders
      ratingHistory = [{ date: new Date().toISOString(), rating: student.rating ?? 0, contestName: 'البداية' }];
    } else {
      const startRating = scored[0].ratingBefore ?? student.rating ?? 0;
      ratingHistory = [
        { date: new Date(scored[0].contest.startTime).toISOString(), rating: startRating, contestName: 'البداية' },
        ...scored.map(p => ({
          date:        new Date(p.contest.startTime).toISOString(),
          rating:      p.ratingAfter,
          contestName: p.contest.title,
        })),
      ];
    }

    return {
      currentRating: student.rating ?? 0,
      stream:        student.stream,
      stats:         { totalContests, totalSolved, avgRank, bestRank },
      ratingHistory,
      contests:      rows,
    };
  }

  // ✅ NEW: shape a participation into the dashboard row shape expected by the frontend.
  // Scoring fields (rank/score/ratingChange/newRating) stay null until the scoring job runs.
  _formatDashboardRow(p) {
    const solved = p.answers.filter(a => a.isCorrect).length;
    return {
      id:                p.contest.id,
      contestName:       p.contest.title,
      date:              p.contest.startTime,
      difficulty:        p.contest.difficulty,
      duration:          p.contest.duration,                          // minutes (frontend formats)
      rank:              p.actualRank,                                // null until scored
      totalParticipants: p.contest._count?.participations ?? 0,
      totalProblems:     p.contest.questionCount ?? p.contest._count?.questions ?? 0,
      score:             p.finalContestScore,                         // null until scored
      ratingChange:      p.ratingDelta,                               // null until scored
      newRating:         p.ratingAfter,                               // null until scored
      solvedProblems:    solved,
    };
  }

  // ✅ NEW: List contests the student participated in that have ended (history).
  // Ignores score/rank/rating fields (scoring job not yet implemented).
  // ✅ CHANGED: now returns ALL ended contests matching the student's stream (not just the ones
  //    the student participated in). Participation status is attached as `myParticipation` so the
  //    UI can distinguish participated vs not, but it no longer filters the list.
  // ✅ CHANGED: removed the stream filter — all students see all ended contests regardless of stream.
  async getMyHistory(userId) {
    const student = await this._getStudent(userId);

    const contests = await prisma.contest.findMany({
      include: { _count: { select: { questions: true, participations: true } } },
    });

    const now = new Date();
    const ended = contests
      .filter(c => now > this._contestEndTime(c))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Attach the student's participation (if any) so the UI can show participation status.
    const contestIds = ended.map(c => c.id);
    const participations = contestIds.length > 0
      ? await prisma.contestParticipation.findMany({
          where:  { contestId: { in: contestIds }, studentId: student.id },
          select: { contestId: true, submittedAt: true },
        })
      : [];
    const pMap = {};
    participations.forEach(p => { pMap[p.contestId] = p; });

    return ended.map(c => {
      const p = pMap[c.id] || null;
      // ✅ NEW: eligible flag for consistency (past tab has no button, but the field is available).
      const eligible = student.year === 'third' && student.stream === c.stream;
      return {
        ...this._formatContestSummary(c, now),
        myParticipation: p,
        submittedAt:     p?.submittedAt ?? null,
        eligible,
      };
    });
  }

  // Start / resume a participation.
  // Creates a ContestParticipation row (scoring fields null, submittedAt null) if none exists,
  // or resumes an existing in-progress one. Returns questions WITHOUT isCorrect (no feedback).
  async startContest(contestId, userId) {
    const student = await this._getStudent(userId);
    const contest = await prisma.contest.findUnique({
      where:   { id: contestId },
      include: { questions: { orderBy: { createdAt: 'asc' }, include: { options: true } } },
    });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Eligibility: stream + 3rd-year
    if (contest.stream !== student.stream)
      throw Object.assign(new Error('Your stream does not match this contest'), { statusCode: 403 });
    if (student.year !== 'third')
      throw Object.assign(new Error('Only 3rd-year students can participate in contests'), { statusCode: 403 });

    // Active window check (server-side time enforcement)
    // ✅ CHANGED: test contests skip the "not started" check but still enforce the end time
    //    (test contests are always available until their termination time).
    const now = new Date();
    const start = new Date(contest.startTime);
    const end   = this._contestEndTime(contest);
    // if (now < start) throw Object.assign(new Error('Contest has not started yet'), { statusCode: 403 });
    // if (now > end)   throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });
    if (!contest.isTest) {
      if (now < start) throw Object.assign(new Error('Contest has not started yet'), { statusCode: 403 });
    }
    // ✅ NEW: end-time check applies to ALL contests (incl. test — unavailable after termination).
    if (now > end) throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });

    // Must have at least one question
    if (contest.questions.length === 0)
      throw Object.assign(new Error('Contest has no questions yet'), { statusCode: 400 });

    // Find or create participation (@@unique([contestId, studentId]) → at most one)
    let participation = await prisma.contestParticipation.findUnique({
      where:  { contestId_studentId: { contestId, studentId: student.id } },
      include: { answers: true },
    });

    if (participation) {
      // Already finally submitted → cannot start again
      if (participation.submittedAt)
        throw Object.assign(new Error('You have already submitted this contest'), { statusCode: 409 });
      // Resume in-progress participation
    } else {
      try {
        participation = await prisma.contestParticipation.create({
          data: { contestId, studentId: student.id },
          include: { answers: true },
        });
      } catch (err) {
        // ✅ NEW: handle P2002 (unique violation on [contestId, studentId]) — a concurrent
        // startContest call created the participation between our findUnique and create.
        // Re-fetch it and resume (find-or-create semantics, race-safe).
        if (err.code === 'P2002') {
          participation = await prisma.contestParticipation.findUnique({
            where:  { contestId_studentId: { contestId, studentId: student.id } },
            include: { answers: true },
          });
          if (!participation) throw err; // shouldn't happen — rethrow if it does
          if (participation.submittedAt)
            throw Object.assign(new Error('You have already submitted this contest'), { statusCode: 409 });
        } else {
          throw err;
        }
      }
    }

    // Build the answered-question-id set for the student's resume state
    const answeredQids = new Set(participation.answers.map(a => a.contestQuestionId));

    return {
      participationId: participation.id,
      contest: {
        id:          contest.id,
        title:       contest.title,
        stream:      contest.stream,
        difficulty:  contest.difficulty,
        duration:    contest.duration,
        startTime:   contest.startTime,
        endTime:     end,
      },
      questions: contest.questions.map(q => this._formatQuestion(q, { includeCorrect: false })),
      // answeredQuestionIds lets the client lock already-submitted questions (no feedback)
      answeredQuestionIds: Array.from(answeredQids),
    };
  }

  // Per-question submit. Records a ContestAnswer (one attempt per question via @@unique).
  // Computes isCorrect server-side but does NOT return it (planning: no feedback during contest).
  async submitQuestionAnswer(contestId, questionId, userId, { selectedOptionId }) {
    const student = await this._getStudent(userId);

    const participation = await prisma.contestParticipation.findUnique({
      where:  { contestId_studentId: { contestId, studentId: student.id } },
    });
    if (!participation)
      throw Object.assign(new Error('No active participation. Start the contest first.'), { statusCode: 400 });
    if (participation.submittedAt)
      throw Object.assign(new Error('You have already submitted this contest'), { statusCode: 409 });

    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Server-side time enforcement
    const now = new Date();
    if (now > this._contestEndTime(contest))
      throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });

    const question = await prisma.contestQuestion.findUnique({
      where:   { id: questionId },
      include: { options: true },
    });
    if (!question || question.contestId !== contestId)
      throw Object.assign(new Error('Question not found in this contest'), { statusCode: 404 });

    // Validate selected option belongs to this question
    const selected = question.options.find(o => o.id === selectedOptionId);
    if (!selected)
      throw Object.assign(new Error('selectedOptionId does not belong to this question'), { statusCode: 400 });

    // Compute isCorrect server-side (scoring-system.md Step 1)
    const isCorrect = selected.isCorrect === true;

    try {
      const answer = await prisma.contestAnswer.create({
        data: {
          participationId:   participation.id,
          contestQuestionId: questionId,
          selectedOptionId,
          isCorrect,
          submittedAt:       now,
        },
      });
      // Return WITHOUT isCorrect (no feedback) — only confirmation + the submittedAt (for client timer display)
      return {
        answerId:     answer.id,
        questionId,
        submittedAt:  answer.submittedAt,
        // isCorrect intentionally omitted
      };
    } catch (err) {
      // Prisma P2002 unique violation = already answered this question
      if (err.code === 'P2002')
        throw Object.assign(new Error('You have already answered this question (one attempt per question)'), { statusCode: 409 });
      throw err;
    }
  }

  // Final whole-contest submission. Marks participation.submittedAt = now.
  // Does NOT compute score (scoring batch job runs after contest ends — out of scope).
  async submitContest(contestId, userId) {
    const student = await this._getStudent(userId);

    const participation = await prisma.contestParticipation.findUnique({
      where:  { contestId_studentId: { contestId, studentId: student.id } },
    });
    if (!participation)
      throw Object.assign(new Error('No active participation. Start the contest first.'), { statusCode: 400 });
    if (participation.submittedAt)
      throw Object.assign(new Error('You have already submitted this contest'), { statusCode: 409 });

    const contest = await prisma.contest.findUnique({ where: { id: contestId } });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Server-side time enforcement: allow final submit up to the end time
    const now = new Date();
    if (now > this._contestEndTime(contest))
      throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });

    const updated = await prisma.contestParticipation.update({
      where:  { id: participation.id },
      data:   { submittedAt: now },
    });

    return {
      participationId: updated.id,
      submittedAt:     updated.submittedAt,
      message:         'تم تقديم المسابقة بنجاح. ستظهر النتيجة بعد انتهاء المسابقة و احتساب الترتيب.',
    };
  }

  // Get the student's current participation + answers (for resume). No isCorrect in output.
  async getMyParticipation(contestId, userId) {
    const student = await this._getStudent(userId);
    const participation = await prisma.contestParticipation.findUnique({
      where:  { contestId_studentId: { contestId, studentId: student.id } },
      include: { contest: true, answers: true },
    });
    if (!participation) throw Object.assign(new Error('No participation found'), { statusCode: 404 });
    // ✅ NEW: block re-entry once the contest has been submitted (matches startContest's 409).
    if (participation.submittedAt)
      throw Object.assign(new Error('You have already submitted this contest'), { statusCode: 409 });

    // Return the contest's questions (without isCorrect) + the answered question ids
    const questions = await prisma.contestQuestion.findMany({
      where:   { contestId },
      orderBy: { createdAt: 'asc' },
      include: { options: true },
    });

    return {
      participationId: participation.id,
      submittedAt:     participation.submittedAt,
      contest: {
        id:          participation.contest.id,
        title:       participation.contest.title,
        stream:      participation.contest.stream,
        difficulty:  participation.contest.difficulty,
        duration:    participation.contest.duration,
        startTime:   participation.contest.startTime,
        endTime:     this._contestEndTime(participation.contest),
      },
      questions:          questions.map(q => this._formatQuestion(q, { includeCorrect: false })),
      answeredQuestionIds: participation.answers.map(a => a.contestQuestionId),
    };
  }

  // ── formatters ─────────────────────────────────────────────────

  _formatContestSummary(c, now) {
    const start = new Date(c.startTime);
    const end   = this._contestEndTime(c);
    // ✅ NEW: test contests ignore the start-time window — always 'active' until terminated.
    const status = c.isTest
      ? (now < end ? 'active' : 'ended')
      : (now < start ? 'upcoming' : now <= end ? 'active' : 'ended');
    return {
      id:              c.id,
      title:           c.title,
      stream:          c.stream,
      difficulty:      c.difficulty,
      duration:        c.duration,
      startTime:       c.startTime,
      endTime:         end,
      status,
      isTest:          c.isTest,   // ✅ NEW: expose isTest so the frontend can bypass time-based disables.
      questionCount:   c.questionCount ?? c._count?.questions ?? 0,
      participationCount: c._count?.participations ?? 0,
    };
  }

  _formatContestDetail(contest, now, { includeCorrect, teacherView, currentTeacherId } = {}) {
    return {
      ...this._formatContestSummary(contest, now),
      questions: (contest.questions || []).map(q => this._formatQuestion(q, { includeCorrect, teacherView, currentTeacherId })),
    };
  }

  // Formats a question. includeCorrect controls whether option.isCorrect is exposed.
  // Students NEVER receive isCorrect (planning: no feedback during contest).
  // ✅ NEW: teacherView adds attribution (aiGenerated + authorName + teacherId) and a per-question
  //    canDelete flag (own + non-AI only). These fields are omitted for student views.
  _formatQuestion(q, { includeCorrect, teacherView, currentTeacherId } = {}) {
    const base = {
      id:         q.id,
      text:       q.text,
      pointValue: q.pointValue,
      options:    (q.options || []).map(o => ({
        id:        o.id,
        text:      o.text,
        ...(includeCorrect ? { isCorrect: o.isCorrect } : {}),
      })),
    };
    if (!teacherView) return base;
    // ✅ NEW: attribution — AI-generated questions show as "AI Generated"; teacher questions show the
    // teacher's real name (User.name). canDelete = own + non-AI (delete permission enforced server-side).
    const aiGenerated = !!q.aiGenerated;
    const authorName  = aiGenerated ? null : (q.teacher?.user?.name || null);
    const canDelete   = !aiGenerated && !!q.teacherId && q.teacherId === currentTeacherId;
    return { ...base, aiGenerated, authorName, teacherId: q.teacherId ?? null, canDelete };
  }
}

export default new ContestsService();
