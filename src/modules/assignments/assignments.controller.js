// backend/src/modules/assignments/assignments.controller.js

import assignmentsService from './assignments.service.js';

const ok   = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });
const fail = (res, message, status = 500) =>
  res.status(status).json({ success: false, message });

class AssignmentsController {

  // GET /api/assignments/teacher/courses
  async getTeacherCourses(req, res) {
    try {
      const data = await assignmentsService.getTeacherCourses(req.user.userId);
      return ok(res, data);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/assignments/teacher/courses/:courseId/lessons
  async getCourseLessons(req, res) {
    try {
      const data = await assignmentsService.getCourseLessons(req.user.userId, req.params.courseId);
      return ok(res, data);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // POST /api/assignments
  async createAssignment(req, res) {
    try {
      const assignment = await assignmentsService.createAssignment(req.user.userId, req.body);
      return ok(res, assignment, 'تم إنشاء الواجب بنجاح', 201);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/assignments/teacher?courseId=xxx
  async getTeacherAssignments(req, res) {
    try {
      const data = await assignmentsService.getTeacherAssignments(req.user.userId, req.query.courseId);
      return ok(res, data);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/assignments/teacher/:assignmentId
  async getAssignmentDetail(req, res) {
    try {
      const data = await assignmentsService.getAssignmentWithSubmissions(req.user.userId, req.params.assignmentId);
      return ok(res, data);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // GET /api/assignments/student
  async getStudentAssignments(req, res) {
    try {
      const data = await assignmentsService.getStudentAssignments(req.user.userId);
      return ok(res, data);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // POST /api/assignments/:assignmentId/submit
  async submitAssignment(req, res) {
    try {
      const file = req.file || null;
      const notes = req.body.notes || '';
      const result = await assignmentsService.submitAssignment(req.user.userId, req.params.assignmentId, file, notes);
      return ok(res, result, 'تم تسليم الواجب بنجاح', 201);
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }

  // PATCH /api/assignments/submissions/:submissionId/grade
  async gradeSubmission(req, res) {
    try {
      const { score, feedback } = req.body;
      const result = await assignmentsService.gradeSubmission(req.user.userId, req.params.submissionId, score, feedback);
      return ok(res, result, 'تم تصحيح الواجب بنجاح');
    } catch (err) {
      return fail(res, err.message, err.statusCode || 500);
    }
  }
}

export default new AssignmentsController();
