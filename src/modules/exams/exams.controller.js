// backend/src/modules/exams/exams.controller.js

import examsService from './exams.service.js';

const sendSuccess = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const sendError = (res, message, status = 500) =>
  res.status(status).json({ success: false, message });

class ExamsController {

  // POST /api/exams
  async createExam(req, res) {
    try {
      const exam = await examsService.createExam(req.user.userId, req.body);
      return sendSuccess(res, exam, 'تم إنشاء الاختبار بنجاح', 201);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/exams/my  → teacher's own exams
  async getMyExams(req, res) {
    try {
      const exams = await examsService.getTeacherExams(req.user.userId);
      return sendSuccess(res, exams);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/exams/:id/attempts  → ✅ NEW
  async getExamAttempts(req, res) {
    try {
      const attempts = await examsService.getExamAttempts(req.params.id, req.user.userId);
      return sendSuccess(res, attempts);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/exams/:id
  async getExam(req, res) {
    try {
      const exam = await examsService.getExam(req.params.id, req.user?.userId);
      return sendSuccess(res, exam);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // PUT /api/exams/:id
  async updateExam(req, res) {
    try {
      const exam = await examsService.updateExam(req.params.id, req.user.userId, req.body);
      return sendSuccess(res, exam, 'تم تحديث الاختبار بنجاح');
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // DELETE /api/exams/:id
  async deleteExam(req, res) {
    try {
      const result = await examsService.deleteExam(req.params.id, req.user.userId);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // PATCH /api/exams/:id/publish
  async togglePublish(req, res) {
    try {
      const result = await examsService.togglePublish(req.params.id, req.user.userId);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }
}

export default new ExamsController();