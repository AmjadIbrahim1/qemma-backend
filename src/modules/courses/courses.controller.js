// backend/src/modules/courses/courses.controller.js
// CHANGE: No multer file — thumbnailBase64 comes via req.body

import coursesService from './courses.service.js';

const sendSuccess = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });

const sendError = (res, message, status = 500) =>
  res.status(status).json({ success: false, message });

class CoursesController {

  async createCourse(req, res) {
    try {
      // thumbnailBase64 is in req.body (JSON)
      const course = await coursesService.createCourse(req.user.userId, req.body);
      return sendSuccess(res, course, 'تم إنشاء الكورس بنجاح', 201);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async getMyCourses(req, res) {
    try {
      const courses = await coursesService.getTeacherCourses(req.user.userId);
      return sendSuccess(res, courses);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async getPublishedCourses(req, res) {
    try {
      const result = await coursesService.getPublishedCourses(req.query);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async getTeacherProfile(req, res) {
    try {
      const profile = await coursesService.getTeacherProfile(req.params.teacherId);
      return sendSuccess(res, profile);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async getTeacherProfileByUserId(req, res) {
    try {
      const profile = await coursesService.getTeacherProfileByUserId(req.params.userId);
      return sendSuccess(res, profile);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async getCourse(req, res) {
    try {
      const course = await coursesService.getCourse(req.params.id, req.user?.userId);
      return sendSuccess(res, course);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async updateCourse(req, res) {
    try {
      const course = await coursesService.updateCourse(req.params.id, req.user.userId, req.body);
      return sendSuccess(res, course, 'تم تحديث الكورس بنجاح');
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async deleteCourse(req, res) {
    try {
      const result = await coursesService.deleteCourse(req.params.id, req.user.userId);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }

  async togglePublish(req, res) {
    try {
      const result = await coursesService.togglePublish(req.params.id, req.user.userId);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, err.statusCode || 500);
    }
  }
}

export default new CoursesController();