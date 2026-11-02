// backend/src/modules/enrollments/enrollments.controller.js

import enrollmentsService from './enrollments.service.js';

class EnrollmentsController {

  async getMyEnrollments(req, res, next) {
    try {
      const data = await enrollmentsService.getStudentEnrollments(req.user.userId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getCourseDetail(req, res, next) {
    try {
      const data = await enrollmentsService.getStudentCourseDetail(
        req.user.userId,
        req.params.courseId
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async updateProgress(req, res, next) {
    try {
      const { progress } = req.body;
      if (progress === undefined) {
        return res.status(400).json({ success: false, message: 'progress is required' });
      }
      const data = await enrollmentsService.updateProgress(
        req.user.userId,
        req.params.courseId,
        progress
      );
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export default new EnrollmentsController();