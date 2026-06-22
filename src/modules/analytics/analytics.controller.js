// backend/src/modules/analytics/analytics.controller.js

import ExcelJS from 'exceljs';
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

  async exportTeacherStats(req, res, next) {
    try {
      const { courses, exams, enrollments, attempts } = await analyticsService.getTeacherExportData(req.user.userId);

      const workbook = new ExcelJS.Workbook();

      // ── Sheet 1: Courses Summary ────────────────────────────────
      const ws1 = workbook.addWorksheet('Courses Summary');
      ws1.columns = [
        { header: 'Course Title', key: 'title', width: 35 },
        { header: 'Enrollments', key: 'enrollments', width: 15 },
        { header: 'Lessons', key: 'lessons', width: 12 },
        { header: 'Exams', key: 'exams', width: 10 },
        { header: 'Published', key: 'published', width: 12 },
      ];
      courses.forEach(c => ws1.addRow({
        title: c.title,
        enrollments: c._count.enrollments,
        lessons: c._count.lessons,
        exams: c._count.exams,
        published: c.isPublished ? 'Yes' : 'No',
      }));

      // ── Sheet 2: Student Enrollments ────────────────────────────
      const ws2 = workbook.addWorksheet('Student Enrollments');
      ws2.columns = [
        { header: 'Student Name', key: 'name', width: 30 },
        { header: 'Email', key: 'email', width: 35 },
        { header: 'Course', key: 'course', width: 35 },
        { header: 'Enrolled At', key: 'enrolledAt', width: 20 },
      ];
      enrollments.forEach(e => ws2.addRow({
        name: e.student?.user?.name || 'Unknown',
        email: e.student?.user?.email || '',
        course: e.course?.title || '',
        enrolledAt: e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString('en-GB') : '',
      }));

      // ── Sheet 3: Exam Results ───────────────────────────────────
      const ws3 = workbook.addWorksheet('Exam Results');
      ws3.columns = [
        { header: 'Student Name', key: 'name', width: 30 },
        { header: 'Exam Title', key: 'exam', width: 35 },
        { header: 'Score', key: 'score', width: 10 },
        { header: 'Total Marks', key: 'total', width: 14 },
        { header: 'Percentage', key: 'pct', width: 12 },
        { header: 'Passed', key: 'passed', width: 10 },
        { header: 'Submitted At', key: 'submittedAt', width: 20 },
      ];
      attempts.forEach(a => ws3.addRow({
        name: a.student?.user?.name || 'Unknown',
        exam: a.exam?.title || '',
        score: a.score,
        total: a.exam?.totalMarks || 0,
        pct: a.exam?.totalMarks ? Math.round((a.score / a.exam.totalMarks) * 100) + '%' : '',
        passed: a.isPassed ? 'Yes' : 'No',
        submittedAt: a.submittedAt ? new Date(a.submittedAt).toLocaleDateString('en-GB') : '',
      }));

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="teacher-statistics.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (error) {
      next(error);
    }
  }
}

export default new AnalyticsController();