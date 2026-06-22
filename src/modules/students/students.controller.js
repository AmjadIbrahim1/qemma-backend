// backend/src/modules/students/students.controller.js

import studentsService from './students.service.js';

class StudentsController {

  // ── Get full student dashboard data ─────────────────────────
  async getDashboard(req, res, next) {
    try {
      const data = await studentsService.getStudentDashboard(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // ── Get detailed performance report ─────────────────────────
  async getPerformance(req, res, next) {
    try {
      const data = await studentsService.getPerformanceReport(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // ── Get pending tasks (exams not taken, assignments not submitted, lessons not viewed) ──
  async getTasks(req, res, next) {
    try {
      const data = await studentsService.getStudentTasks(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  // ── Rate a lesson ─────────────────────────────────────────────
  async rateLesson(req, res, next) {
    try {
      const { lessonId } = req.params;
      const { rating } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'التقييم يجب أن يكون بين 1 و 5' });
      }
      const result = await studentsService.rateLesson(req.user.userId, lessonId, parseInt(rating));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Rate a teacher ────────────────────────────────────────────
  async rateTeacher(req, res, next) {
    try {
      const { teacherId } = req.params;
      const { rating, comment } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'التقييم يجب أن يكون بين 1 و 5' });
      }
      const result = await studentsService.rateTeacher(req.user.userId, teacherId, parseInt(rating), comment || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Get lesson average rating ─────────────────────────────────
  async getLessonRating(req, res, next) {
    try {
      const { lessonId } = req.params;
      const result = await studentsService.getLessonRating(lessonId, req.user?.userId || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Get teacher average rating + comments ────────────────────
  async getTeacherRating(req, res, next) {
    try {
      const { teacherId } = req.params;
      const result = await studentsService.getTeacherRating(teacherId, req.user?.userId || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Rate a course ──────────────────────────────────────────────
  async rateCourse(req, res, next) {
    try {
      const { courseId } = req.params;
      const { rating } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'التقييم يجب أن يكون بين 1 و 5' });
      }
      const result = await studentsService.rateCourse(req.user.userId, courseId, parseInt(rating));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Rate a book ────────────────────────────────────────────────
  async rateBook(req, res, next) {
    try {
      const { bookId } = req.params;
      const { rating, comment } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'التقييم يجب أن يكون بين 1 و 5' });
      }
      const result = await studentsService.rateBook(req.user.userId, bookId, parseInt(rating), comment || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Get course average rating ──────────────────────────────────
  async getCourseRating(req, res, next) {
    try {
      const { courseId } = req.params;
      const result = await studentsService.getCourseRating(courseId, req.user?.userId || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Get book average rating + comments ────────────────────────
  async getBookRating(req, res, next) {
    try {
      const { bookId } = req.params;
      const result = await studentsService.getBookRating(bookId, req.user?.userId || null);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export default new StudentsController();
