// backend/src/modules/parents/parents.controller.js

import parentsService from './parents.service.js';

const ok = (res, data, message = 'Success', status = 200) =>
  res.status(status).json({ success: true, message, data });
const fail = (res, err) =>
  res.status(err.statusCode || 500).json({ success: false, message: err.message });

class ParentsController {

  // ── GET /api/parents/children ────────────────────────────────
  async getChildren(req, res, next) {
    try {
      const children = await parentsService.getChildren(req.user.userId);
      return ok(res, children);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/summary ───────────────
  async getChildSummary(req, res, next) {
    try {
      const data = await parentsService.getChildSummary(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/dashboard ─────────────
  async getChildDashboard(req, res, next) {
    try {
      const data = await parentsService.getChildDashboard(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/performance ───────────
  async getChildPerformance(req, res, next) {
    try {
      const data = await parentsService.getChildPerformance(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/tasks ─────────────────
  async getChildTasks(req, res, next) {
    try {
      const data = await parentsService.getChildTasks(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/exam-results ──────────
  async getChildExamResults(req, res, next) {
    try {
      const data = await parentsService.getChildExamResults(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/courses ───────────────
  async getChildCourses(req, res, next) {
    try {
      const data = await parentsService.getChildCourses(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/courses/:courseId ─────
  async getChildCourseDetails(req, res, next) {
    try {
      const data = await parentsService.getChildCourseDetails(
        req.user.userId,
        req.params.childId,
        req.params.courseId,
      );
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/books ─────────────────
  async getChildBooks(req, res, next) {
    try {
      const data = await parentsService.getChildBooks(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/children/:childId/notifications ─────────
  async getChildNotifications(req, res, next) {
    try {
      const data = await parentsService.getChildNotifications(req.user.userId, req.params.childId);
      return ok(res, data);
    } catch (err) { next(err); }
  }

  // ── GET /api/parents/reports/export ────────────────────────────
  async exportReportsExcel(req, res, next) {
    try {
      const rows = await parentsService.exportToExcel(req.user.userId);
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Parent Reports');

      ws.columns = [
        { header: 'Child Name', key: 'childName', width: 30 },
        { header: 'Email', key: 'childEmail', width: 35 },
        { header: 'Username', key: 'childUsername', width: 25 },
        { header: 'Grade', key: 'childGrade', width: 12 },
        { header: 'Stream', key: 'childStream', width: 18 },
        { header: 'Courses', key: 'courses', width: 50 },
        { header: 'Courses Count', key: 'coursesCount', width: 16 },
        { header: 'Avg Grade (%)', key: 'avgGrade', width: 16 },
        { header: 'Attendance (%)', key: 'attendanceRate', width: 18 },
        { header: 'Exams Taken', key: 'examsCount', width: 14 },
        { header: 'Avg Exam Score', key: 'avgExamScore', width: 16 },
        { header: 'Assignments Completed', key: 'assignmentsCompleted', width: 24 },
        { header: 'Strengths', key: 'strengths', width: 40 },
        { header: 'Weaknesses', key: 'weaknesses', width: 40 },
      ];

      rows.forEach(r => ws.addRow(r));

      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="parent-reports.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err) { next(err); }
  }

  // ── POST /api/parents/link-child ───────────────────────────────
  async linkChild(req, res, next) {
    try {
      const { studentUsername } = req.body;
      const result = await parentsService.linkChild(req.user.userId, studentUsername);
      const msg = result.alreadyLinked
        ? 'الطالب مرتبط بالفعل بحسابك'
        : 'تم ربط الطالب بنجاح';
      return ok(res, result, msg, result.alreadyLinked ? 200 : 201);
    } catch (err) { next(err); }
  }
}

export default new ParentsController();
