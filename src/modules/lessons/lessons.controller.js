// backend/src/modules/lessons/lessons.controller.js

import lessonsService from './lessons.service.js';

const sendSuccess = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const sendError = (res, message, status = 500) =>
  res.status(status).json({ success: false, message });

class LessonsController {

  // POST /api/lessons
  async createLesson(req, res) {
    try {
      const videoFile = req.files?.video?.[0] ?? null;
      const pdfFile   = req.files?.pdf?.[0]   ?? null;

      const lesson = await lessonsService.createLesson(
        req.user.userId,
        req.body,
        videoFile,
        pdfFile,
      );
      return sendSuccess(res, lesson, 'تم إنشاء الدرس بنجاح', 201);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/lessons/course/:courseId
  async getCourseLessons(req, res) {
    try {
      const lessons = await lessonsService.getCourseLessons(
        req.params.courseId,
        req.user?.userId,
      );
      return sendSuccess(res, lessons);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/lessons/:id
  async getLesson(req, res) {
    try {
      const lesson = await lessonsService.getLesson(req.params.id, req.user?.userId);
      return sendSuccess(res, lesson);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // PUT /api/lessons/:id
  async updateLesson(req, res) {
    try {
      const videoFile = req.files?.video?.[0] ?? null;
      const pdfFile   = req.files?.pdf?.[0]   ?? null;

      const lesson = await lessonsService.updateLesson(
        req.params.id,
        req.user.userId,
        req.body,
        videoFile,
        pdfFile,
      );
      return sendSuccess(res, lesson, 'تم تحديث الدرس بنجاح');
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  // DELETE /api/lessons/:id
  async deleteLesson(req, res) {
    try {
      const result = await lessonsService.deleteLesson(req.params.id, req.user.userId);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }
}

export default new LessonsController();