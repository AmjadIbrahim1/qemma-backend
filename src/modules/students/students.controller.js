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
}

export default new StudentsController();
