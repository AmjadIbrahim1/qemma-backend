// backend/src/modules/contests/contests.controller.js
// ✅ NEW (contests feature): Controller class — try/catch → service. Mirrors exams.controller.js.

import contestsService from './contests.service.js';

const ok = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

class ContestsController {

  // ── FEATURE 1: TEACHER — question management ───────────────────

  // GET /api/contests/teacher — upcoming contests the teacher can add questions to
  async getTeacherContests(req, res, next) {
    try {
      const contests = await contestsService.getTeacherContests(req.user.userId);
      return ok(res, contests);
    } catch (err) { next(err); }
  }

  // ✅ NEW: GET /api/contests/teacher/history — ended contests the teacher can see
  async getTeacherPastContests(req, res, next) {
    try {
      const contests = await contestsService.getTeacherPastContests(req.user.userId);
      return ok(res, contests);
    } catch (err) { next(err); }
  }

  // GET /api/contests/:id — contest detail (teacher: with questions + correct options)
  async getContest(req, res, next) {
    try {
      const contest = await contestsService.getContestForTeacher(req.params.id, req.user.userId);
      return ok(res, contest);
    } catch (err) { next(err); }
  }

  // GET /api/contests/:id/questions — questions list (teacher view)
  async getContestQuestions(req, res, next) {
    try {
      const questions = await contestsService.getContestQuestions(req.params.id, req.user.userId);
      return ok(res, questions);
    } catch (err) { next(err); }
  }

  // POST /api/contests/:id/questions — add one MCQ question
  async addContestQuestion(req, res, next) {
    try {
      const question = await contestsService.addContestQuestion(req.params.id, req.user.userId, req.body);
      return ok(res, question, 'تم إضافة السؤال بنجاح', 201);
    } catch (err) { next(err); }
  }

  // DELETE /api/contests/:id/questions/:questionId — remove a question (before contest starts)
  async deleteContestQuestion(req, res, next) {
    try {
      const result = await contestsService.deleteContestQuestion(req.params.id, req.params.questionId, req.user.userId);
      return ok(res, result);
    } catch (err) { next(err); }
  }

  // ── FEATURE 2: STUDENT — participation ─────────────────────────

  // GET /api/contests/available — contests the student can join (stream + 3rd-year + active window)
  async getAvailableContests(req, res, next) {
    try {
      const contests = await contestsService.getAvailableContests(req.user.userId);
      return ok(res, contests);
    } catch (err) { next(err); }
  }

  // ✅ NEW: GET /api/contests/my-history — contests the student participated in (ended)
  async getMyHistory(req, res, next) {
    try {
      const contests = await contestsService.getMyHistory(req.user.userId);
      return ok(res, contests);
    } catch (err) { next(err); }
  }

  // POST /api/contests/:id/start — start/resume a participation
  async startContest(req, res, next) {
    try {
      const data = await contestsService.startContest(req.params.id, req.user.userId);
      return ok(res, data, 'تم بدء المسابقة');
    } catch (err) { next(err); }
  }

  // POST /api/contests/:id/questions/:questionId/submit — per-question submit
  async submitQuestionAnswer(req, res, next) {
    try {
      const data = await contestsService.submitQuestionAnswer(
        req.params.id, req.params.questionId, req.user.userId, req.body,
      );
      return ok(res, data, 'تم تسجيل الإجابة');
    } catch (err) { next(err); }
  }

  // POST /api/contests/:id/submit — final whole-contest submission
  async submitContest(req, res, next) {
    try {
      const data = await contestsService.submitContest(req.params.id, req.user.userId);
      return ok(res, data, 'تم تقديم المسابقة');
    } catch (err) { next(err); }
  }

  // GET /api/contests/:id/participation — resume info (student's participation + answered questions)
  async getMyParticipation(req, res, next) {
    try {
      const data = await contestsService.getMyParticipation(req.params.id, req.user.userId);
      return ok(res, data);
    } catch (err) { next(err); }
  }
}

export default new ContestsController();
