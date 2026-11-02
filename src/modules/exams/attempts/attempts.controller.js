// backend/src/modules/exams/attempts/attempts.controller.js

import attemptsService from './attempts.service.js';

class AttemptsController {

  async getTeacherAttempts(req, res, next) {
    try {
      const teacherId = req.user.teacherId || req.user.userId;
      const { examId, courseId, status, page, limit } = req.query;

      // Resolve teacherId from Teacher table
      const { default: prisma } = await import('../../../config/prisma.config.js');
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.userId } });
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found' });
      }

      // If assistant teacher, use the linked teacher's ID to find their exams
      const effectiveTeacherId = teacher.linkedTeacherId || teacher.id;
      const result = await attemptsService.getTeacherAttempts(effectiveTeacherId, { examId, courseId, status, page, limit });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getAttemptById(req, res, next) {
    try {
      const attempt = await attemptsService.getAttemptById(req.params.id);
      res.status(200).json({ success: true, data: attempt });
    } catch (error) {
      next(error);
    }
  }

  async gradeAttempt(req, res, next) {
    try {
      const { score, feedback } = req.body;
      const attempt = await attemptsService.gradeAttempt(req.params.id, { score: parseFloat(score), feedback });
      res.status(200).json({ success: true, data: attempt });
    } catch (error) {
      next(error);
    }
  }

  async autoGrade(req, res, next) {
    try {
      const attempt = await attemptsService.autoGrade(req.params.id);
      res.status(200).json({ success: true, data: attempt });
    } catch (error) {
      next(error);
    }
  }

  // ── STUDENT: Start exam ────────────────────────────────────
  async startExam(req, res, next) {
    try {
      const data = await attemptsService.startExam(req.params.examId, req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // ── STUDENT: Get exam review ───────────────────────────────
  async getStudentReviewData(req, res, next) {
    try {
      const data = await attemptsService.getStudentReviewData(req.params.examId, req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // ── STUDENT: Submit exam ───────────────────────────────────
  async submitExam(req, res, next) {
    try {
      const { answers } = req.body;
      if (!answers || typeof answers !== 'object') {
        return res.status(400).json({ success: false, message: 'Answers object is required' });
      }
      const result = await attemptsService.submitExam(req.params.examId, req.user.userId, answers);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getExamStats(req, res, next) {
    try {
      const { default: prisma } = await import('../../../config/prisma.config.js');
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.userId } });
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found' });
      }
      const stats = await attemptsService.getExamStats(teacher.id);
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }

  // ── ASSISTANT TEACHER: Grade essay questions ────────────────
  async assistantGradeEssays(req, res, next) {
    try {
      const { essayScores } = req.body;
      if (!essayScores || typeof essayScores !== 'object') {
        return res.status(400).json({ success: false, message: 'essayScores object is required' });
      }
      const result = await attemptsService.assistantGradeEssays(
        req.params.id,
        req.user.userId,
        { essayScores }
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export default new AttemptsController();