// backend/src/modules/analytics/analytics.service.js

import prisma from '../../config/prisma.config.js';

class AnalyticsService {

  // ── Teacher overall report ────────────────────────────────────
  async getTeacherReport(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const [courses, attempts, enrollments] = await Promise.all([
      prisma.course.findMany({
        where: { teacherId: teacher.id },
        include: {
          _count: { select: { enrollments: true, lessons: true, exams: true } },
        },
      }),
      prisma.examAttempt.findMany({
        where: {
          exam: { teacherId: teacher.id },
          submittedAt: { not: null },
          score: { not: null },
        },
        select: { score: true, isPassed: true, submittedAt: true, exam: { select: { totalMarks: true } } },
      }),
      prisma.enrollment.findMany({
        where: { course: { teacherId: teacher.id } },
        select: { enrolledAt: true },
      }),
    ]);

    const totalStudents   = enrollments.length;
    const totalCourses    = courses.length;
    const publishedCourses = courses.filter(c => c.isPublished).length;
    const totalExams      = courses.reduce((s, c) => s + c._count.exams, 0);
    const totalLessons    = courses.reduce((s, c) => s + c._count.lessons, 0);

    const gradedAttempts  = attempts.filter(a => a.score !== null);
    const passedAttempts  = attempts.filter(a => a.isPassed);
    const avgScore = gradedAttempts.length > 0
      ? gradedAttempts.reduce((s, a) => s + (a.score || 0), 0) / gradedAttempts.length
      : 0;
    const passRate = gradedAttempts.length > 0
      ? (passedAttempts.length / gradedAttempts.length) * 100
      : 0;

    // Enrollment trend (last 6 months)
    const now = new Date();
    const enrollmentTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('ar-EG', { month: 'long' });
      const count = enrollments.filter(e => {
        const ed = new Date(e.enrolledAt);
        return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
      }).length;
      enrollmentTrend.push({ month: label, students: count });
    }

    // Score distribution
    const scoreDist = [
      { label: 'ممتاز (90-100)', min: 90, max: 100, color: '#059669' },
      { label: 'جيد جداً (80-89)', min: 80, max: 89, color: '#2563eb' },
      { label: 'جيد (70-79)', min: 70, max: 79, color: '#f59e0b' },
      { label: 'مقبول (60-69)', min: 60, max: 69, color: '#dc2626' },
      { label: 'راسب (أقل من 60)', min: 0, max: 59, color: '#991b1b' },
    ].map(band => {
      const count = gradedAttempts.filter(a => {
        if (!a.exam?.totalMarks || !a.score) return false;
        const pct = (a.score / a.exam.totalMarks) * 100;
        return pct >= band.min && pct <= band.max;
      }).length;
      return { name: band.label, value: count, color: band.color };
    });

    // Top students
    const studentScores = {};
    for (const a of gradedAttempts) {
      // We'd need studentId — fetch separately for top students
    }

    // Top students via separate query
    const topStudentsRaw = await prisma.examAttempt.groupBy({
      by: ['studentId'],
      where: { exam: { teacherId: teacher.id }, score: { not: null } },
      _avg: { score: true },
      _count: { id: true },
      orderBy: { _avg: { score: 'desc' } },
      take: 5,
    });

    const topStudents = await Promise.all(
      topStudentsRaw.map(async (s) => {
        const student = await prisma.student.findUnique({
          where: { id: s.studentId },
          include: { user: { select: { name: true, avatar: true } } },
        });
        return {
          name: student?.user?.name || 'مجهول',
          avatar: student?.user?.name?.[0] || '؟',
          avgScore: Math.round((s._avg.score || 0) * 10) / 10,
          examsCount: s._count.id,
        };
      })
    );

    // Course performance
    const coursePerformance = courses.map(c => ({
      name: c.title.length > 20 ? c.title.slice(0, 20) + '...' : c.title,
      students: c._count.enrollments,
    }));

    return {
      summary: {
        totalStudents,
        totalCourses,
        publishedCourses,
        totalExams,
        totalLessons,
        avgScore: Math.round(avgScore * 10) / 10,
        passRate: Math.round(passRate),
        totalAttempts: gradedAttempts.length,
      },
      enrollmentTrend,
      scoreDist,
      topStudents,
      coursePerformance,
    };
  }

  // ── Teacher export data (for Excel) ────────────────────────────
  async getTeacherExportData(userId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const [courses, exams, enrollments, attempts] = await Promise.all([
      prisma.course.findMany({
        where: { teacherId: teacher.id },
        include: { _count: { select: { enrollments: true, lessons: true, exams: true } } },
      }),
      prisma.exam.findMany({
        where: { teacherId: teacher.id },
        include: { _count: { select: { attempts: true } }, course: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.enrollment.findMany({
        where: { course: { teacherId: teacher.id } },
        include: { student: { include: { user: { select: { name: true, email: true } } } }, course: { select: { title: true } } },
      }),
      prisma.examAttempt.findMany({
        where: { exam: { teacherId: teacher.id }, score: { not: null } },
        include: { exam: { select: { title: true, totalMarks: true } }, student: { include: { user: { select: { name: true } } } } },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    return { courses, exams, enrollments, attempts };
  }

  // ── Student performance detail ────────────────────────────────
  async getStudentPerformance(teacherId, studentId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });

    const attempts = await prisma.examAttempt.findMany({
      where: {
        studentId,
        exam: { teacherId: teacher.id },
        submittedAt: { not: null },
      },
      include: {
        exam: { select: { title: true, totalMarks: true, passingMarks: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    return attempts.map(a => ({
      examTitle: a.exam.title,
      score: a.score,
      totalMarks: a.exam.totalMarks,
      isPassed: a.isPassed,
      percentage: a.exam.totalMarks ? Math.round(((a.score || 0) / a.exam.totalMarks) * 100) : 0,
      submittedAt: a.submittedAt,
    }));
  }
}

export default new AnalyticsService();