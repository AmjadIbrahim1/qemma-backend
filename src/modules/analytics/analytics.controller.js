// backend/src/modules/analytics/analytics.controller.js

import analyticsService from './analytics.service.js';

class AnalyticsController {

  async getTeacherReport(req, res, next) {
    try {
      const data = await analyticsService.getTeacherReport(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getStudentPerformance(req, res, next) {
    try {
      const data = await analyticsService.getStudentPerformance(req.user.userId, req.params.studentId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

export default new AnalyticsController();