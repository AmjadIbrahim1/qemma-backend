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

  // ── FEATURE 1: TEACHER — question management ───────────────────

  // List contests the teacher is authorized to add questions to (upcoming AND active).
  // ✅ CHANGED: was `startTime > now` (upcoming only) — now includes active contests so teachers
  //    can add questions to always-open dev test contests. Filters: stream match AND not ended.
  async getTeacherContests(userId) {
    const teacher = await this._getTeacher(userId);
    const allowedStreams = getAllowedContestStreams(teacher.stream);
    if (allowedStreams.length === 0) return [];

    const contests = await prisma.contest.findMany({
      where:   { stream: { in: allowedStreams } },
      include: { _count: { select: { questions: true, participations: true } } },
      orderBy: { startTime: 'asc' },
    });

    const now = new Date();
    // ✅ CHANGED: was `startTime: { gt: new Date() }` in Prisma where — now filter in JS: not ended
    // const upcomingOnly = contests.filter(c => new Date(c.startTime) > now);  // OLD: upcoming only
    const notEnded = contests.filter(c => now < this._contestEndTime(c));
    return notEnded.map(c => this._formatContestSummary(c, now));
  }

  // ✅ NEW: List ended contests the teacher is authorized to see (past contests).
  // Filters: contest.stream ∈ getAllowedContestStreams(teacher.stream) AND now > endTime.
  async getTeacherPastContests(userId) {
    const teacher = await this._getTeacher(userId);
    const allowedStreams = getAllowedContestStreams(teacher.stream);
    if (allowedStreams.length === 0) return [];

    const contests = await prisma.contest.findMany({
      where:   { stream: { in: allowedStreams } },
      include: { _count: { select: { questions: true, participations: true } } },
    });

    const now = new Date();
    const ended = contests
      .filter(c => now > this._contestEndTime(c))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return ended.map(c => this._formatContestSummary(c, now));
  }

  // Get one contest (teacher view: includes questions with options incl. isCorrect).
  async getContestForTeacher(contestId, userId) {
    const teacher = await this._getTeacher(userId);
    const contest = await prisma.contest.findUnique({
      where:   { id: contestId },
      include: { questions: { orderBy: { createdAt: 'asc' }, include: { options: true, _count: { select: { answers: true } } } } },
    });
    if (!contest) throw Object.assign(new Error('Contest not found'), { statusCode: 404 });

    // Authorization: teacher's stream must allow this contest's stream
    if (!canTeacherAddToContest(teacher.stream, contest.stream))
      throw Object.assign(new Error('You are not authorized to access this contest (stream mismatch)'), { statusCode: 403 });

    const now = new Date();
    return this._formatContestDetail(contest, now, { includeCorrect: true });
  }

  // List questions for a contest (teacher view, with correct options).
  async getContestQuestions(contestId, userId) {
    const contest = await this.getContestForTeacher(contestId, userId);
    return contest.questions;
  }

  // Add one MCQ question to a contest.
  // Payload: { text, pointValue, options: [{ text, isCorrect }] }
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
    if (!contest.isTest && new Date() >= new Date(contest.startTime))
      throw Object.assign(new Error('Cannot add questions after the contest has started'), { statusCode: 403 });

    // Validate payload
    const { text, pointValue, options } = data;
    if (!text || !text.trim()) throw Object.assign(new Error('Question text is required'), { statusCode: 400 });
    if (!pointValue || pointValue < 1) throw Object.assign(new Error('pointValue must be >= 1'), { statusCode: 400 });
    if (!Array.isArray(options) || options.length < 2)
      throw Object.assign(new Error('At least 2 options are required'), { statusCode: 400 });

    const correctCount = options.filter(o => o.isCorrect === true).length;
    if (correctCount !== 1)
      throw Object.assign(new Error('Exactly one option must be marked isCorrect'), { statusCode: 400 });
    if (options.some(o => !o.text || !o.text.trim()))
      throw Object.assign(new Error('All options must have non-empty text'), { statusCode: 400 });

    // Transactional create: ContestQuestion + ContestOption[] (mirrors exams.service.js createExam)
    const question = await prisma.$transaction(async (tx) => {
      const newQ = await tx.contestQuestion.create({
        data: { contestId, text: text.trim(), pointValue: parseInt(pointValue) },
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
        include: { options: true },
      });
    });

    // Update denormalized questionCount on the contest
    await prisma.contest.update({
      where: { id: contestId },
      data:  { questionCount: { increment: 1 } },
    });

    return this._formatQuestion(question, { includeCorrect: true });
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
    if (!contest.isTest && new Date() >= new Date(contest.startTime))
      throw Object.assign(new Error('Cannot delete questions after the contest has started'), { statusCode: 403 });

    const question = await prisma.contestQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.contestId !== contestId)
      throw Object.assign(new Error('Question not found in this contest'), { statusCode: 404 });

    await prisma.contestQuestion.delete({ where: { id: questionId } });

    await prisma.contest.update({
      where: { id: contestId },
      data:  { questionCount: { decrement: 1 } },
    });

    return { message: 'Question deleted successfully' };
  }

  // ── FEATURE 2: STUDENT — participation ─────────────────────────

  // List contests the student can see (upcoming AND active).
  // Eligibility (per decisions): student.stream === contest.stream AND student.year === 'third'
  // AND hasn't ended yet: now < startTime+duration (includes upcoming + active).
  async getAvailableContests(userId) {
    const student = await this._getStudent(userId);

    // ✅ Per decision: participation restricted to 3rd-year + stream match
    if (student.year !== 'third')
      return [];

    const now = new Date();
    const contests = await prisma.contest.findMany({
      where:   { stream: student.stream || '__none__' },
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
      return {
        ...this._formatContestSummary(c, now),
        myParticipation: p,
        hasSubmitted:    !!p?.submittedAt,
      };
    });
  }

  // ✅ NEW: List contests the student participated in that have ended (history).
  // Ignores score/rank/rating fields (scoring job not yet implemented).
  async getMyHistory(userId) {
    const student = await this._getStudent(userId);

    const participations = await prisma.contestParticipation.findMany({
      where:   { studentId: student.id },
      include: { contest: { include: { _count: { select: { questions: true, participations: true } } } } },
    });

    const now = new Date();
    const ended = participations
      .filter(p => now > this._contestEndTime(p.contest))
      .sort((a, b) => new Date(b.contest.startTime) - new Date(a.contest.startTime));
    return ended.map(p => ({
      ...this._formatContestSummary(p.contest, now),
      submittedAt: p.submittedAt,
    }));
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
    // ✅ CHANGED: skip time check for dev test contests (isTest=true) — students can participate at any time
    const now = new Date();
    const start = new Date(contest.startTime);
    const end   = this._contestEndTime(contest);
    // if (now < start) throw Object.assign(new Error('Contest has not started yet'), { statusCode: 403 });
    // if (now > end)   throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });
    if (!contest.isTest) {
      if (now < start) throw Object.assign(new Error('Contest has not started yet'), { statusCode: 403 });
      if (now > end)   throw Object.assign(new Error('Contest has ended'), { statusCode: 403 });
    }

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
      participation = await prisma.contestParticipation.create({
        data: { contestId, studentId: student.id },
        include: { answers: true },
      });
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
    const status = now < start ? 'upcoming' : now <= end ? 'active' : 'ended';
    return {
      id:              c.id,
      title:           c.title,
      stream:          c.stream,
      difficulty:      c.difficulty,
      duration:        c.duration,
      startTime:       c.startTime,
      endTime:         end,
      status,
      questionCount:   c.questionCount ?? c._count?.questions ?? 0,
      participationCount: c._count?.participations ?? 0,
    };
  }

  _formatContestDetail(contest, now, { includeCorrect } = {}) {
    return {
      ...this._formatContestSummary(contest, now),
      questions: (contest.questions || []).map(q => this._formatQuestion(q, { includeCorrect })),
    };
  }

  // Formats a question. includeCorrect controls whether option.isCorrect is exposed.
  // Students NEVER receive isCorrect (planning: no feedback during contest).
  _formatQuestion(q, { includeCorrect } = {}) {
    return {
      id:         q.id,
      text:       q.text,
      pointValue: q.pointValue,
      options:    (q.options || []).map(o => ({
        id:        o.id,
        text:      o.text,
        ...(includeCorrect ? { isCorrect: o.isCorrect } : {}),
      })),
    };
  }
}

export default new ContestsService();
