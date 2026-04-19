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

      const result = await attemptsService.getTeacherAttempts(teacher.id, { examId, courseId, status, page, limit });
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
}

export default new AttemptsController();