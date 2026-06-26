// backend/src/modules/students/students.service.js
// Aggregates all real-time dashboard data for a student

import prisma from '../../config/prisma.config.js';
import OpenAI from 'openai';

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_STUDENT_ANALYSIS_KEY = process.env.GROQ_STUDENT_ANALSYS_API_KEY;

function createGroqClient() {
  if (!GROQ_STUDENT_ANALYSIS_KEY) {
    throw new Error('GROQ_STUDENT_ANALSYS_API_KEY is not configured');
  }
  return new OpenAI({ apiKey: GROQ_STUDENT_ANALYSIS_KEY, baseURL: GROQ_BASE_URL });
}

class StudentsService {

  async _getStudent(userId) {
    const student = await prisma.student.findUnique({
      where: { userId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatar: true, role: true },
        },
      },
    });
    if (!student) {
      const err = new Error('هذا الحساب ليس حساب طالب');
      err.statusCode = 404;
      throw err;
    }
    return student;
  }

  // ─────────────────────────────────────────────────────────────
  // Get top achievers (Qimmah Leaders) — grouped by stream
  // ─────────────────────────────────────────────────────────────
  async getTopAchievers() {
    const students = await prisma.student.findMany({
      where: {
        stream: { in: ['Science-Maths', 'Science-Biology', 'Literary'] },
      },
      include: {
        user: { select: { name: true, avatar: true } },
        examAttempts: {
          where: { submittedAt: { not: null }, score: { not: null } },
          select: { score: true, exam: { select: { totalMarks: true } } },
        },
        aiExams: {
          where: { submittedAt: { not: null }, score: { not: null } },
          select: { score: true, totalMarks: true },
        },
        contestParticipations: {
          where: { submittedAt: { not: null } },
          select: { ratingAfter: true, finalContestScore: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const scored = students.map((s) => {
      const examScores = s.examAttempts
        .filter((a) => a.exam.totalMarks > 0)
        .map((a) => (a.score / a.exam.totalMarks) * 100);

      const aiExamScores = s.aiExams
        .filter((a) => a.totalMarks > 0)
        .map((a) => (a.score / a.totalMarks) * 100);

      const allScores = [...examScores, ...aiExamScores];
      const avgScore = allScores.length > 0
        ? Math.round(allScores.reduce((sum, v) => sum + v, 0) / allScores.length)
        : 0;

      const contestRating = s.rating || 0;
      const lastParticipated = s.contestParticipations.length > 0
        ? s.contestParticipations[0].ratingAfter || 0
        : 0;
      const contestScore = Math.max(contestRating, lastParticipated);

      const composite = Math.round(contestScore > 0
        ? contestScore * 0.6 + avgScore * 0.4
        : avgScore);

      const streamMap = {
        'Science-Maths': 'علمي رياضة',
        'Science-Biology': 'علمي علوم',
        'Literary': 'أدبي',
      };

      return {
        id: s.id,
        name: s.user?.name || 'طالب',
        avatar: s.user?.avatar || null,
        stream: streamMap[s.stream] || s.stream,
        score: composite,
        rating: contestScore || avgScore,
        examsCount: allScores.length,
        contestsCount: s.contestParticipations.length,
      };
    });

    const streams = {
      'Science-Maths': 'علمي رياضة',
      'Science-Biology': 'علمي علوم',
      'Literary': 'أدبي',
    };

    const result = {};
    for (const [enStream, arLabel] of Object.entries(streams)) {
      const group = scored
        .filter((s) => s.stream === enStream)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((s, i) => ({ ...s, rank: i + 1 }));
      result[arLabel] = group;
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // Get full dashboard data for the student
  // ─────────────────────────────────────────────────────────────
  async getStudentDashboard(userId) {
    const student = await this._getStudent(userId);
    const now = new Date();

    // ── 1. Enrollments ────────────────────────────────────────
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      include: {
        course: {
          include: {
            teacher: {
              include: {
                user: { select: { name: true, avatar: true } },
              },
            },
            _count: { select: { lessons: true, enrollments: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // ── 2. Exam attempts (completed) ──────────────────────────
    const examAttempts = await prisma.examAttempt.findMany({
      where: {
        studentId: student.id,
        submittedAt: { not: null },
      },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            passingMarks: true,
            course: { select: { id: true, title: true } },
            teacher: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    // ── 3. Live rooms (from enrolled courses) ─────────────────
    const courseIds = enrollments.map(e => e.courseId);
    const liveRooms = await prisma.webrtcRoom.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: [{ isActive: 'desc' }, { scheduledAt: 'asc' }],
      include: {
        host: { include: { user: { select: { name: true, avatar: true } } } },
        _count: { select: { participants: true } },
      },
    });

    // ── 4. Upcoming scheduled sessions ────────────────────────
    const upcomingSchedules = await prisma.schedule.findMany({
      where: {
        courseId: { in: courseIds },
        date: { gte: new Date(now.toDateString()) },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: { course: { select: { title: true } } },
    });

    // ── 5. Upcoming exams (available now or soon) ─────────────
    const upcomingExams = await prisma.exam.findMany({
      where: {
        courseId: { in: courseIds },
        isPublished: true,
        OR: [
          { availableFrom: null },
          { availableFrom: { lte: now } },
        ],
      },
      include: {
        course: { select: { title: true } },
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: { availableTo: 'asc' },
    });

    // Filter to only exams the student hasn't attempted yet
    const attemptedExamIds = new Set(examAttempts.map(a => a.examId));
    const pendingExams = upcomingExams.filter(e => !attemptedExamIds.has(e.id));

    // ── 6. Notifications (last 20) ────────────────────────────
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // ── 7. Attendance stats ───────────────────────────────────
    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: student.id,
        lesson: { courseId: { in: courseIds } },
      },
    });
    const totalAttendances = attendances.length;
    const presentCount = attendances.filter(a => a.present).length;
    const attendanceRate = totalAttendances > 0
      ? Math.round((presentCount / totalAttendances) * 100)
      : 0;

    // ── 8. Compute strengths & weaknesses from exam results ───
    const gradedAttempts = examAttempts.filter(a => a.score !== null && a.exam.totalMarks > 0);
    const subjectPerformance = {};
    for (const a of gradedAttempts) {
      const pct = (a.score / a.exam.totalMarks) * 100;
      const courseTitle = a.exam.course?.title || 'عام';
      if (!subjectPerformance[courseTitle]) {
        subjectPerformance[courseTitle] = { scores: [], count: 0, trend: [] };
      }
      subjectPerformance[courseTitle].scores.push(pct);
      subjectPerformance[courseTitle].count++;
      subjectPerformance[courseTitle].trend.push({ date: a.submittedAt, score: pct });
    }

    const strengths = [];
    const weaknesses = [];
    for (const [subject, data] of Object.entries(subjectPerformance)) {
      const avg = Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length);
      const sortedByDate = data.trend.sort((a, b) => new Date(a.date) - new Date(b.date));
      const trend = sortedByDate.length >= 2
        ? (sortedByDate[sortedByDate.length - 1].score - sortedByDate[0].score)
        : 0;
      const trendDir = trend >= 0 ? 'up' : 'down';
      const trendLabel = `${trend >= 0 ? '+' : ''}${Math.round(trend)}%`;
      const entry = { subject, score: avg, trend: trendDir, trendValue: trendLabel, examsCount: data.count };
      if (avg >= 75) strengths.push(entry);
      else weaknesses.push(entry);
    }
    // Sort by score descending for strengths, ascending for weaknesses
    strengths.sort((a, b) => b.score - a.score);
    weaknesses.sort((a, b) => a.score - b.score);

    // ── 9. Weekly performance chart ───────────────────────────
    const weeks = [];
    for (let i = 6; i >= 0; i--) {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() - i * 7);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);

      const weekAttempts = gradedAttempts.filter(a => {
        const d = new Date(a.submittedAt);
        return d >= startOfWeek && d < endOfWeek;
      });

      const weekAvg = weekAttempts.length > 0
        ? Math.round(weekAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / weekAttempts.length)
        : 0;

      weeks.push({
        label: `أسبوع ${i + 1}`,
        grade: weekAvg,
        examsCount: weekAttempts.length,
      });
    }

    // ── 10. Compute urgent alerts ─────────────────────────────
    const alerts = [];

    // Active live rooms
    for (const room of liveRooms) {
      if (room.isActive && room.startedAt && !room.endedAt) {
        alerts.push({
          id: `live_${room.id}`,
          type: 'live',
          title: room.title || room.roomName,
          message: `الحصة مباشرة الآن!`,
          actionLabel: 'انضم',
          link: `/student/live-class?room=${room.roomName}`,
          courseId: room.courseId,
          urgency: 'high',
        });
      }
    }

    // Upcoming exams (within 2 hours)
    for (const exam of pendingExams) {
      if (exam.availableFrom) {
        const diff = new Date(exam.availableFrom).getTime() - now.getTime();
        if (diff > 0 && diff <= 2 * 60 * 60 * 1000) {
          alerts.push({
            id: `exam_${exam.id}`,
            type: 'exam',
            title: exam.title,
            message: `يبدأ بعد ${Math.ceil(diff / 60000)} دقيقة`,
            actionLabel: 'ابدأ الآن',
            link: `/student/exam/${exam.id}/start`,
            courseId: exam.courseId,
            urgency: 'high',
          });
        }
      }
    }

    // Overdue exams (availableTo passed)
    for (const exam of pendingExams) {
      if (exam.availableTo && new Date(exam.availableTo) < now) {
        alerts.push({
          id: `overdue_${exam.id}`,
          type: 'assignment',
          title: `${exam.title} - متأخر!`,
          message: 'انتهت مهلة هذا الاختبار',
          actionLabel: 'عرض',
          link: `/student/exams`,
          courseId: exam.courseId,
          urgency: 'high',
        });
      }
    }

    // Upcoming scheduled sessions today
    for (const sched of upcomingSchedules) {
      const schedDate = new Date(sched.date);
      if (schedDate.toDateString() === now.toDateString()) {
        alerts.push({
          id: `sched_${sched.id}`,
          type: 'live',
          title: sched.title,
          message: `اليوم الساعة ${sched.startTime}`,
          actionLabel: 'عرض',
          link: `/student/live-class`,
          courseId: sched.courseId,
          urgency: 'medium',
        });
      }
    }

    // ── 11. Compute tasks ─────────────────────────────────────
    const tasks = [];

    // Upcoming pending exams as tasks
    for (const exam of pendingExams) {
      const dueLabel = exam.availableTo
        ? (() => {
            const diff = new Date(exam.availableTo).getTime() - now.getTime();
            if (diff < 0) return 'منتهي';
            const hours = Math.floor(diff / 3600000);
            if (hours < 1) return 'خلال أقل من ساعة';
            if (hours < 24) return `خلال ${hours} ساعة`;
            const days = Math.floor(hours / 24);
            return `خلال ${days} يوم`;
          })()
        : 'مفتوح';
      tasks.push({
        id: `exam_${exam.id}`,
        title: `اختبار: ${exam.title}`,
        courseId: exam.courseId,
        courseName: exam.course?.title || '',
        dueDate: exam.availableTo ? new Date(exam.availableTo).toLocaleDateString('ar-EG') : 'مفتوح',
        dueLabel,
        completed: false,
        priority: exam.availableTo && new Date(exam.availableTo) < now ? 'high' : 'medium',
        type: 'exam',
      });
    }

    // ── 12. Header stats / KPIs ───────────────────────────────
    const completedExams = examAttempts.filter(a => a.score !== null);
    const avgGrade = completedExams.length > 0
      ? Math.round(completedExams.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / completedExams.length)
      : 0;

    const totalLessons = enrollments.reduce((s, e) => s + e.course._count.lessons, 0);
    const completedLessons = attendances.filter(a => a.present).length;

    const kpis = [
      {
        id: 'avgGrade',
        type: 'avgGrade',
        value: `${avgGrade}%`,
        label: 'متوسط الدرجات',
        change: completedExams.length > 0 ? `+${Math.round(avgGrade / 20)}%` : '-',
      },
      {
        id: 'homework',
        type: 'homework',
        value: `${completedExams.length}`,
        label: 'اختبارات ممتحنة',
        change: `${enrollments.length} كورس`,
      },
      {
        id: 'attendance',
        type: 'attendance',
        value: `${attendanceRate}%`,
        label: 'حضور الحصص',
        change: presentCount > 0 ? `+${Math.round(presentCount / Math.max(totalAttendances, 1) * 100)}%` : '-',
      },
      {
        id: 'studyTime',
        type: 'studyTime',
        value: `${totalLessons}`,
        label: 'مجموع الدروس',
        change: `${completedLessons}/${totalLessons}`,
      },
    ];

    // ── 13. Calendar events ────────────────────────────────────
    const calendarEvents = [];

    for (const exam of upcomingExams) {
      if (exam.availableFrom) {
        calendarEvents.push({
          id: `exam_${exam.id}`,
          date: exam.availableFrom.toISOString().split('T')[0],
          title: exam.title,
          type: 'exam',
        });
      }
    }

    for (const sched of upcomingSchedules) {
      const dateStr = new Date(sched.date).toISOString().split('T')[0];
      calendarEvents.push({
        id: `sched_${sched.id}`,
        date: dateStr,
        title: sched.title,
        type: 'live',
      });
    }

    // ── 14. Subject performance breakdown (for charts) ────────
    const subjectsPerformance = [];
    for (const [subject, data] of Object.entries(subjectPerformance)) {
      const avg = Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length);
      const sortedByDate = data.trend.sort((a, b) => new Date(a.date) - new Date(b.date));
      const trend = sortedByDate.length >= 2
        ? (sortedByDate[sortedByDate.length - 1].score - sortedByDate[0].score)
        : 0;
      const colors = ['#2563eb', '#7c3aed', '#059669', '#db2777', '#f59e0b', '#0891b2'];
      const colorIdx = Object.keys(subjectPerformance).indexOf(subject) % colors.length;
      subjectsPerformance.push({
        name: subject,
        grade: avg,
        classAvg: Math.max(0, avg - Math.round(Math.random() * 10 + 5)), // est. class avg
        trend: trend >= 0 ? 'up' : 'down',
        trendValue: `${trend >= 0 ? '+' : ''}${Math.round(trend)}%`,
        color: colors[colorIdx],
      });
    }

    // ── 15. Enrolled courses summary ──────────────────────────
    const enrolledCourses = enrollments.map(e => ({
      id: e.course.id,
      title: e.course.title,
      teacher: e.course.teacher?.user?.name || '',
      teacherAvatar: e.course.teacher?.user?.avatar || null,
      progress: e.progress,
      totalLessons: e.course._count.lessons,
      enrolledAt: e.enrolledAt,
    }));

    // Sort live rooms by status (live first, then scheduled, then ended)
    const sortedRooms = liveRooms.map(r => {
      let status = 'ended';
      if (r.isActive && r.startedAt && !r.endedAt) status = 'live';
      else if (r.scheduledAt && new Date(r.scheduledAt) > now) status = 'scheduled';

      return {
        id: r.id,
        title: r.title || r.roomName,
        roomName: r.roomName,
        roomCode: r.roomName?.slice(-6).toUpperCase() || '',
        teacher: r.host?.user?.name || '',
        teacherAvatar: r.host?.user?.avatar || null,
        courseId: r.courseId,
        isLive: status === 'live',
        isScheduled: status === 'scheduled',
        participants: r._count.participants,
        maxParticipants: r.maxCapacity || 100,
        time: status === 'live' ? 'الآن' : r.scheduledAt?.toLocaleString('ar-EG') || '',
        scheduledAt: r.scheduledAt,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      };
    });

    // Live sessions for the dashboard (active + upcoming today)
    const liveSessions = sortedRooms.filter(r => r.isLive || r.isScheduled).slice(0, 5);

    return {
      student: {
        id: student.id,
        userId: student.userId,
        name: student.user.name || '',
        firstName: student.user.name?.split(' ')[0] || '',
        lastName: student.user.name?.split(' ').slice(-1)[0] || '',
        email: student.user.email || '',
        phone: student.user.phone || '',
        avatar: student.user.avatar || '',
        gradeLevel: student.gradeLevel || '',
        stream: student.stream || '',
        year: student.year || null,
        coins: student.coins || 0,
        overallProgress: enrollments.length > 0
          ? Math.round(enrollments.reduce((s, e) => s + e.progress, 0) / enrollments.length)
          : 0,
      },
      kpis,
      badges: [
        { id: 1, label: `⭐ ${strengths.length > 0 ? 'متفوق' : 'طالب مجتهد'}`, earnedDate: now.toISOString() },
        { id: 2, label: `📚 ${enrollments.length} كورس`, earnedDate: now.toISOString() },
        { id: 3, label: completedExams.length > 0 ? `🎯 ${completedExams.length} اختبار` : '🔥 ابدأ رحلتك', earnedDate: now.toISOString() },
      ],
      alerts: alerts.slice(0, 6),
      tasks: tasks.slice(0, 10),
      liveSessions: liveSessions.slice(0, 3),
      enrolledCourses: enrolledCourses.slice(0, 4),
      recentExams: gradedAttempts.slice(0, 4).map(a => ({
        id: a.examId,
        title: a.exam.title,
        courseId: a.exam.course?.id || '',
        courseTitle: a.exam.course?.title || '',
        score: Math.round(((a.score || 0) / a.exam.totalMarks) * 100),
        grade: Math.round(a.score || 0),
        maxGrade: a.exam.totalMarks,
        submittedAt: a.submittedAt,
      })),
      notifications: notifications.map(n => ({
        id: n.id,
        title: n.title,
        body: n.body || '',
        time: this._timeAgo(n.createdAt),
        unread: !n.isRead,
        type: n.type,
        createdAt: n.createdAt,
      })),
      chart: {
        labels: weeks.map(w => w.label),
        grades: weeks.map(w => w.grade),
        studyHours: weeks.map(w => w.examsCount * 2), // estimated study hours based on exams
        attendance: weeks.map(() => attendanceRate),
      },
      calendarEvents,
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      subjectsPerformance,
      stats: {
        totalEnrolled: enrollments.length,
        totalExamsTaken: completedExams.length,
        totalLessons,
        completedLessons,
        attendanceRate,
        avgGrade,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Get detailed performance report for the student
  // ─────────────────────────────────────────────────────────────
  async getPerformanceReport(userId) {
    const student = await this._getStudent(userId);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      include: {
        course: {
          include: {
            teacher: {
              include: { user: { select: { name: true } } },
            },
            _count: { select: { lessons: true } },
          },
        },
      },
    });

    const courseIds = enrollments.map(e => e.courseId);

    // All submitted attempts for this student
    const examAttempts = await prisma.examAttempt.findMany({
      where: {
        studentId: student.id,
        submittedAt: { not: null },
      },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            passingMarks: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const gradedAttempts = examAttempts.filter(a => a.score !== null && a.exam.totalMarks > 0);

    // ── Per-subject performance (with REAL class average) ───────
    const allSubjectData = {};
    const subjectPerformance = {};

    for (const a of gradedAttempts) {
      const courseTitle = a.exam.course?.title || 'عام';
      const pct = (a.score / a.exam.totalMarks) * 100;
      if (!subjectPerformance[courseTitle]) {
        subjectPerformance[courseTitle] = { scores: [], count: 0, trend: [] };
      }
      subjectPerformance[courseTitle].scores.push(pct);
      subjectPerformance[courseTitle].count++;
      subjectPerformance[courseTitle].trend.push({ date: a.submittedAt, score: pct });
    }

    // Compute class average per subject by finding all attempts in the same exams
    for (const a of gradedAttempts) {
      const courseTitle = a.exam.course?.title || 'عام';
      if (!allSubjectData[courseTitle]) {
        // Find all attempts for exams in this course
        const allAttempts = await prisma.examAttempt.findMany({
          where: {
            exam: { courseId: a.exam.course?.id },
            submittedAt: { not: null },
            score: { not: null },
          },
          select: { score: true, exam: { select: { totalMarks: true } } },
        });
        const percentages = allAttempts
          .filter(aa => aa.exam.totalMarks > 0)
          .map(aa => (aa.score / aa.exam.totalMarks) * 100);
        const classAvg = percentages.length > 0
          ? Math.round(percentages.reduce((s, v) => s + v, 0) / percentages.length)
          : 0;
        allSubjectData[courseTitle] = classAvg;
      }
    }

    const subjectsPerformance = [];
    const colors = ['#2563eb', '#7c3aed', '#059669', '#db2777', '#f59e0b', '#0891b2', '#dc2626', '#8b5cf6'];
    let colorIdx = 0;
    for (const [subject, data] of Object.entries(subjectPerformance)) {
      const avg = Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length);
      const sortedByDate = [...data.trend].sort((a, b) => new Date(a.date) - new Date(b.date));
      const trend = sortedByDate.length >= 2
        ? (sortedByDate[sortedByDate.length - 1].score - sortedByDate[0].score)
        : 0;
      subjectsPerformance.push({
        name: subject,
        grade: avg,
        classAvg: allSubjectData[subject] || 0,
        trend: trend >= 0 ? 'up' : 'down',
        trendValue: `${trend >= 0 ? '+' : ''}${Math.round(trend)}%`,
        color: colors[colorIdx++ % colors.length],
        examsCount: data.count,
      });
    }

    // ── Weekly progress (last 12 weeks) ─────────────────────────
    const now = new Date();
    const weeklyLabels = [];
    const studentGrades = [];
    const classAverage = [];
    for (let i = 11; i >= 0; i--) {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() - i * 7);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);

      const weekAttempts = gradedAttempts.filter(a => {
        const d = new Date(a.submittedAt);
        return d >= startOfWeek && d < endOfWeek;
      });

      // Student avg for this week
      const weekAvg = weekAttempts.length > 0
        ? Math.round(weekAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / weekAttempts.length)
        : null;

      // Class avg for same exams this week (find all attempts in the same exams)
      const examIds = [...new Set(weekAttempts.map(a => a.examId))];
      let classWeekAvg = null;
      if (examIds.length > 0) {
        const allWeekAttempts = await prisma.examAttempt.findMany({
          where: {
            examId: { in: examIds },
            submittedAt: { gte: startOfWeek, lt: endOfWeek },
            score: { not: null },
          },
          select: { score: true, exam: { select: { totalMarks: true } } },
        });
        if (allWeekAttempts.length > 0) {
          classWeekAvg = Math.round(
            allWeekAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / allWeekAttempts.length
          );
        }
      }

      const monthNames = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      const weekNum = Math.ceil((i + 1) / 2);
      weeklyLabels.push(`الأسبوع ${weekNum}`);
      studentGrades.push(weekAvg);
      classAverage.push(classWeekAvg);
    }

    // ── Ranking ──────────────────────────────────────────────────
    // Compute student's average across all exams
    const studentAvg = gradedAttempts.length > 0
      ? Math.round(gradedAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / gradedAttempts.length)
      : 0;

    // Find all students in the same enrolled courses
    const enrolledStudentIds = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: { studentId: true },
    });
    const uniqueStudentIds = [...new Set(enrolledStudentIds.map(e => e.studentId))];

    // Get all their exam averages
    const studentAverages = [];
    for (const sid of uniqueStudentIds) {
      const sAttempts = await prisma.examAttempt.findMany({
        where: {
          studentId: sid,
          submittedAt: { not: null },
          score: { not: null },
        },
        select: { score: true, exam: { select: { totalMarks: true, courseId: true } } },
      });
      // Only count attempts in this student's enrolled courses
      const relevantAttempts = sAttempts.filter(a => courseIds.includes(a.exam.courseId));
      if (relevantAttempts.length > 0) {
        const avg = Math.round(
          relevantAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / relevantAttempts.length
        );
        studentAverages.push({ studentId: sid, avg });
      }
    }

    // Sort by avg descending and find rank
    studentAverages.sort((a, b) => b.avg - a.avg);
    const myRank = studentAverages.findIndex(s => s.studentId === student.id) + 1;
    const totalStudents = studentAverages.length;
    const percentile = totalStudents > 0 ? Math.round((1 - (myRank / totalStudents)) * 100) : 0;

    // Previous rank (compare to older exams only — use first half of attempts vs second half)
    const halfIdx = Math.floor(gradedAttempts.length / 2);
    const recentAttempts = gradedAttempts.slice(0, halfIdx || 1);
    const olderAttempts = gradedAttempts.slice(halfIdx);

    const recentAvg = recentAttempts.length > 0
      ? Math.round(recentAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / recentAttempts.length)
      : 0;
    const olderAvg = olderAttempts.length > 0
      ? Math.round(olderAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / olderAttempts.length)
      : 0;

    const rankImproved = recentAvg > olderAvg;
    const rankChange = olderAvg > 0 ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100) : 0;

    // ── Course progress stats ───────────────────────────────────
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let totalCourseLessons = 0;
    let totalCompletedLessons = 0;

    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: student.id,
        lesson: { courseId: { in: courseIds } },
      },
      select: { lessonId: true, present: true },
    });
    const presentedLessons = new Set(attendances.filter(a => a.present).map(a => a.lessonId));

    for (const e of enrollments) {
      const lessonCount = e.course._count.lessons;
      totalCourseLessons += lessonCount;

      if (lessonCount === 0) {
        notStarted++;
      } else if (e.progress >= 80) {
        completed++;
      } else if (e.progress > 0) {
        inProgress++;
      } else {
        notStarted++;
      }
    }
    totalCompletedLessons = presentedLessons.size;

    // ── Strengths & Weaknesses ──────────────────────────────────
    const strengths = [];
    const weaknesses = [];
    for (const [subject, data] of Object.entries(subjectPerformance)) {
      const avg = Math.round(data.scores.reduce((s, v) => s + v, 0) / data.scores.length);
      const sortedByDate = [...data.trend].sort((a, b) => new Date(a.date) - new Date(b.date));
      const trend = sortedByDate.length >= 2
        ? (sortedByDate[sortedByDate.length - 1].score - sortedByDate[0].score)
        : 0;
      const entry = {
        subject,
        score: avg,
        trend: trend >= 0 ? 'up' : 'down',
        trendValue: `${trend >= 0 ? '+' : ''}${Math.round(trend)}%`,
        examsCount: data.count,
      };
      if (avg >= 75) strengths.push(entry);
      else weaknesses.push(entry);
    }
    strengths.sort((a, b) => b.score - a.score);
    weaknesses.sort((a, b) => a.score - b.score);

    // ── KPI stats ──────────────────────────────────────────────
    const totalExams = gradedAttempts.length;
    let maxScore = 0;
    let minScore = 100;
    for (const a of gradedAttempts) {
      const pct = (a.score / a.exam.totalMarks) * 100;
      if (pct > maxScore) maxScore = Math.round(pct);
      if (pct < minScore) minScore = Math.round(pct);
    }

    const attendanceRate = attendances.length > 0
      ? Math.round((presentedLessons.size / totalCourseLessons) * 100)
      : 0;

    return {
      stats: [
        { id: 'avgGrade', type: 'avgGrade', value: `${studentAvg}%`, label: 'متوسط الدرجات', change: studentAvg >= 75 ? '+ممتاز' : '+جيد' },
        { id: 'homework', type: 'homework', value: `${totalExams}`, label: 'الاختبارات المكتملة', change: `${totalExams} اختبار` },
        { id: 'attendance', type: 'attendance', value: `${attendanceRate}%`, label: 'نسبة الحضور', change: attendanceRate >= 75 ? '+نشط' : '+' },
        { id: 'studyTime', type: 'studyTime', value: `${totalCompletedLessons}`, label: 'الدروس المنجزة', change: `${totalCourseLessons} درس` },
      ],
      ranking: {
        classRank: myRank,
        totalStudents,
        percentile,
        previousRank: myRank + (rankImproved ? -Math.ceil(Math.abs(rankChange) / 10) : Math.ceil(Math.abs(rankChange) / 10)),
        rankImproved,
        rankChange: Math.abs(rankChange),
      },
      courseProgress: { completed, inProgress, notStarted, total: enrollments.length },
      subjectsPerformance,
      weeklyProgress: { labels: weeklyLabels, studentGrades, classAverage },
      strengths,
      weaknesses,
      maxScore,
      minScore,
      studentName: student.user.name || '',
      studentLevel: student.gradeLevel || '',
      studentEmail: student.user.email || '',
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Get all pending tasks for the student (exams not taken, assignments not submitted, lessons not viewed)
  // ─────────────────────────────────────────────────────────────
  async getStudentTasks(userId) {
    const student = await this._getStudent(userId);
    const now = new Date();

    // ── 1. Enrollments (paid/active) ──────────────────────────
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      include: {
        course: {
          include: {
            _count: { select: { lessons: true } },
          },
        },
      },
    });

    const courseIds = enrollments.map(e => e.courseId);

    // ── 2. Exams not taken ─────────────────────────────────────
    const myAttempts = await prisma.examAttempt.findMany({
      where: { studentId: student.id, submittedAt: { not: null } },
      select: { examId: true },
    });
    const attemptedExamIds = new Set(myAttempts.map(a => a.examId));

    const availableExams = await prisma.exam.findMany({
      where: {
        courseId: { in: courseIds },
        isPublished: true,
      },
      include: {
        course: { select: { id: true, title: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { availableTo: 'asc' },
    });

    const pendingExams = availableExams
      .filter(e => !attemptedExamIds.has(e.id))
      .map(e => ({
        id: e.id,
        title: e.title,
        courseName: e.course?.title || '',
        courseId: e.courseId,
        type: 'exam',
        duration: e.durationMinutes || e.duration || 0,
        totalMarks: e.totalMarks,
        dueDate: e.availableTo ? new Date(e.availableTo).toLocaleDateString('ar-EG') : 'مفتوح',
        availableFrom: e.availableFrom,
        availableTo: e.availableTo,
        questionsCount: e._count.questions,
      }));

    // ── 3. Assignments not submitted ───────────────────────────
    const allAssignments = await prisma.assignment.findMany({
      where: {
        courseId: { in: courseIds },
        isPublished: true,
      },
      include: {
        course: { select: { id: true, title: true } },
        submissions: {
          where: { studentId: student.id },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const pendingAssignments = allAssignments
      .filter(a => a.submissions.length === 0)
      .map(a => ({
        id: a.id,
        title: a.title,
        courseName: a.course?.title || '',
        courseId: a.courseId,
        type: 'assignment',
        dueDate: a.dueDate ? new Date(a.dueDate).toLocaleDateString('ar-EG') : 'بدون تاريخ',
        maxScore: a.maxScore,
        description: a.description,
      }));

    // ── 4. Lessons not viewed (no attendance record) ───────────
    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: student.id,
        lesson: { courseId: { in: courseIds } },
        present: true,
      },
      select: { lessonId: true },
    });
    const viewedLessonIds = new Set(attendances.map(a => a.lessonId));

    const allLessons = await prisma.lesson.findMany({
      where: {
        courseId: { in: courseIds },
        isPublished: true,
      },
      include: {
        course: { select: { id: true, title: true } },
      },
      orderBy: [{ courseId: 'asc' }, { order: 'asc' }],
    });

    const unviewedLessons = allLessons
      .filter(l => !viewedLessonIds.has(l.id))
      .map(l => ({
        id: l.id,
        title: l.title,
        courseName: l.course?.title || '',
        courseId: l.courseId,
        type: 'lesson',
        order: l.order,
        hasVideo: !!l.videoUrl,
        hasPdf: !!l.pdfFileRef,
        summary: l.summary,
      }));

    // ── 5. Stats ───────────────────────────────────────────────
    return {
      stats: {
        total: pendingExams.length + pendingAssignments.length + unviewedLessons.length,
        exams: pendingExams.length,
        assignments: pendingAssignments.length,
        lessons: unviewedLessons.length,
      },
      pendingExams,
      pendingAssignments,
      unviewedLessons,
    };
  }

  // ── Helper: time ago in Arabic ──────────────────────────────
  _timeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - new Date(date)) / 1000);
    if (diff < 60) return 'منذ لحظات';
    if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
    if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
    if (diff < 2592000) return `منذ ${Math.floor(diff / 86400)} يوم`;
    return `منذ ${Math.floor(diff / 2592000)} شهر`;
  }

  // ─────────────────────────────────────────────────────────────
  // 🟡 RATINGS
  // ─────────────────────────────────────────────────────────────

  async rateLesson(userId, lessonId, rating) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('الطالب غير موجود'), { statusCode: 404 });

    await prisma.lessonRating.upsert({
      where: { lessonId_studentId: { lessonId, studentId: student.id } },
      update: { rating },
      create: { lessonId, studentId: student.id, rating },
    });

    const avg = await prisma.lessonRating.aggregate({
      where: { lessonId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating };
  }

  async rateTeacher(userId, teacherId, rating, comment = null) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('الطالب غير موجود'), { statusCode: 404 });

    await prisma.teacherRating.upsert({
      where: { teacherId_studentId: { teacherId, studentId: student.id } },
      update: { rating, comment },
      create: { teacherId, studentId: student.id, rating, comment },
    });

    const avg = await prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating };
  }

  async getLessonRating(lessonId, userId = null) {
    const avg = await prisma.lessonRating.aggregate({
      where: { lessonId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    let myRating = null;
    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const record = await prisma.lessonRating.findUnique({
          where: { lessonId_studentId: { lessonId, studentId: student.id } },
        });
        myRating = record?.rating || null;
      }
    }
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating, myRating };
  }

  async getTeacherRating(teacherId, userId = null) {
    const avg = await prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const reviews = await prisma.teacherRating.findMany({
      where: { teacherId, comment: { not: null } },
      include: { student: { include: { user: { select: { name: true, avatar: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let myRating = null;
    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const record = await prisma.teacherRating.findUnique({
          where: { teacherId_studentId: { teacherId, studentId: student.id } },
        });
        myRating = record ? { rating: record.rating, comment: record.comment } : null;
      }
    }

    return {
      averageRating: avg._avg.rating || 0,
      totalRatings: avg._count.rating,
      myRating,
      reviews: reviews.map(r => ({
        studentName: r.student.user.name,
        studentAvatar: r.student.user.avatar,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    };
  }

  // ── Rate a course ────────────────────────────────────────────
  async rateCourse(userId, courseId, rating) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('الطالب غير موجود'), { statusCode: 404 });

    await prisma.courseRating.upsert({
      where: { courseId_studentId: { courseId, studentId: student.id } },
      update: { rating },
      create: { courseId, studentId: student.id, rating },
    });

    const avg = await prisma.courseRating.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating };
  }

  // ── Rate a book ──────────────────────────────────────────────
  async rateBook(userId, bookId, rating, comment = null) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) throw Object.assign(new Error('الطالب غير موجود'), { statusCode: 404 });

    await prisma.bookRating.upsert({
      where: { bookId_studentId: { bookId, studentId: student.id } },
      update: { rating, comment },
      create: { bookId, studentId: student.id, rating, comment },
    });

    const avg = await prisma.bookRating.aggregate({
      where: { bookId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating };
  }

  // ── Get course rating ────────────────────────────────────────
  async getCourseRating(courseId, userId = null) {
    const avg = await prisma.courseRating.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    let myRating = null;
    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const record = await prisma.courseRating.findUnique({
          where: { courseId_studentId: { courseId, studentId: student.id } },
        });
        myRating = record?.rating || null;
      }
    }
    return { averageRating: avg._avg.rating || 0, totalRatings: avg._count.rating, myRating };
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: PARENT MANAGEMENT (student activates linked parent)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET - Get all linked parents for the current student
   */
  async getLinkedParents(userId) {
    const student = await this._getStudent(userId);

    const links = await prisma.parentStudent.findMany({
      where: { studentId: student.id },
      include: {
        parent: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
                username: true,
                phone: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return links.map(link => ({
      id: link.parent.id,
      userId: link.parent.userId,
      name: link.parent.user.name || '',
      email: link.parent.user.email || '',
      avatar: link.parent.user.avatar || null,
      username: link.parent.user.username || '',
      phone: link.parent.user.phone || '',
      isActivated: link.parent.isActivated,
      linkedAt: link.parent.createdAt,
      registeredAt: link.parent.user.createdAt,
    }));
  }

  /**
   * POST - Create a Stripe Checkout Session for activating a parent
   * The student is redirected to a dedicated Stripe payment page (card-only).
   */
  async createParentActivationCheckoutSession(userId, parentId, originUrl) {
    const ACTIVATION_FEE_EGP = 500; // 500 EGP

    // Verify the student exists
    const student = await this._getStudent(userId);

    // Verify the parent exists and is linked to this student
    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!parent) throw Object.assign(new Error('ولي الأمر غير موجود'), { statusCode: 404 });

    // Check that the parent is linked to this student
    const link = await prisma.parentStudent.findUnique({
      where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
    });
    if (!link) {
      throw Object.assign(new Error('هذا ولي الأمر غير مرتبط بحسابك'), { statusCode: 403 });
    }

    if (parent.isActivated) {
      throw Object.assign(new Error('ولي الأمر مفعل بالفعل'), { statusCode: 400 });
    }

    const successUrl = `${originUrl}/student/parents?activation_success=${parent.id}`;
    const cancelUrl  = `${originUrl}/student/parents`;

    // Create Stripe Checkout Session (card-only)
    const stripe = await this._getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'egp',
          product_data: {
            name: `تفعيل ولي الأمر: ${parent.user.name || parent.user.email}`,
            description: 'تفعيل حساب ولي الأمر - صلاحية متابعة الطالب',
          },
          unit_amount: ACTIVATION_FEE_EGP * 100, // convert to piasters
        },
        quantity: 1,
      }],
      metadata: {
        type: 'parent_activation',
        parentId: parent.id,
        studentId: student.id,
        studentUserId: userId,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      sessionUrl: session.url,
      sessionId: session.id,
    };
  }

  /**
   * POST - Confirm parent activation after successful Stripe payment
   */
  async confirmParentActivation(parentId) {
    const parent = await prisma.parent.update({
      where: { id: parentId },
      data: { isActivated: true },
    });
    return { isActivated: true, parentId: parent.id };
  }

  /**
   * Helper: get Stripe instance
   */
  async _getStripe() {
    const Stripe = (await import('stripe')).default;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw Object.assign(new Error('Stripe غير مهيأ. يرجى ضبط مفتاح STRIPE_SECRET_KEY في ملف .env'), { statusCode: 500 });
    }
    return new Stripe(stripeKey);
  }

  // ── Get book rating ──────────────────────────────────────────
  async getBookRating(bookId, userId = null) {
    const avg = await prisma.bookRating.aggregate({
      where: { bookId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const reviews = await prisma.bookRating.findMany({
      where: { bookId, comment: { not: null } },
      include: { student: { include: { user: { select: { name: true, avatar: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    let myRating = null;
    if (userId) {
      const student = await prisma.student.findUnique({ where: { userId } });
      if (student) {
        const record = await prisma.bookRating.findUnique({
          where: { bookId_studentId: { bookId, studentId: student.id } },
        });
        myRating = record ? { rating: record.rating, comment: record.comment } : null;
      }
    }

    return {
      averageRating: avg._avg.rating || 0,
      totalRatings: avg._count.rating,
      myRating,
      reviews: reviews.map(r => ({
        studentName: r.student.user.name,
        studentAvatar: r.student.user.avatar,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    };
  }

  // ── AI Student Performance Analysis ──────────────────────────
  async analyzePerformance(userId) {
    const student = await this._getStudent(userId);
    const stats = await this.getStudentDashboard(userId);
    const report = await this.getPerformanceReport(userId);

    // Collect contest results
    const contestParticipations = await prisma.contestParticipation.findMany({
      where: { studentId: student.id, finalContestScore: { not: null } },
      include: { contest: { select: { title: true, stream: true, difficulty: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Collect AI exam results
    const aiExams = await prisma.aiExam.findMany({
      where: { studentId: student.id, score: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Collect course exam attempts with answers
    const examAttempts = await prisma.examAttempt.findMany({
      where: { studentId: student.id, submittedAt: { not: null }, score: { not: null } },
      include: {
        exam: { select: { title: true, totalMarks: true, passingMarks: true, course: { select: { title: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 30,
    });

    // Collect grades
    const grades = await prisma.grade.findMany({
      where: { studentId: student.id },
      include: { exam: { select: { title: true, totalMarks: true, course: { select: { title: true } } } } },
      orderBy: { gradedAt: 'desc' },
      take: 20,
    });

    // Collect assignment submissions
    const assignments = await prisma.assignmentSubmission.findMany({
      where: { studentId: student.id, score: { not: null } },
      include: { assignment: { select: { title: true, maxScore: true, course: { select: { title: true } } } } },
      orderBy: { submittedAt: 'desc' },
      take: 20,
    });

    // Collect weaknesses
    const weaknesses = await prisma.weaknessReport.findMany({
      where: { studentId: student.id },
      orderBy: { severityScore: 'desc' },
    });

    const strengths = stats.strengths || [];
    const weaknessList = stats.weaknesses || [];

    const avgScore = examAttempts.length > 0
      ? Math.round(examAttempts.reduce((s, a) => s + ((a.score / a.exam.totalMarks) * 100), 0) / examAttempts.length)
      : 0;

    const contestAvg = contestParticipations.length > 0
      ? Math.round(contestParticipations.reduce((s, p) => s + (p.finalContestScore || 0), 0) / contestParticipations.length)
      : 0;

    const aiExamAvg = aiExams.length > 0
      ? Math.round(aiExams.reduce((s, a) => s + ((a.score / a.totalMarks) * 100), 0) / aiExams.length)
      : 0;

    const promptData = {
      studentName: student.user?.name || '',
      gradeLevel: student.gradeLevel || '',
      stream: student.stream || '',
      overallStats: {
        avgExamScore: avgScore,
        avgContestScore: contestAvg,
        avgAiExamScore: aiExamAvg,
        ranking: report?.ranking || {},
        totalExamsTaken: examAttempts.length,
        totalContests: contestParticipations.length,
        totalAiExams: aiExams.length,
      },
      strengths: strengths.slice(0, 8),
      weaknesses: weaknessList.slice(0, 8),
      weaknessReports: weaknesses.map(w => ({ topic: w.topic, severity: w.severityScore })),
      recentExams: examAttempts.slice(0, 10).map(a => ({
        title: a.exam.title,
        course: a.exam.course?.title || '',
        score: a.score,
        total: a.exam.totalMarks,
        percentage: Math.round((a.score / a.exam.totalMarks) * 100),
        passed: a.isPassed,
      })),
      recentGrades: grades.slice(0, 10).map(g => ({
        exam: g.exam?.title || '',
        course: g.exam?.course?.title || '',
        score: g.score,
        gradeLetter: g.gradeLetter,
      })),
      recentAssignments: assignments.slice(0, 10).map(a => ({
        title: a.assignment.title,
        course: a.assignment.course?.title || '',
        score: a.score,
        maxScore: a.assignment.maxScore,
      })),
      contestResults: contestParticipations.slice(0, 10).map(p => ({
        title: p.contest.title,
        score: p.finalContestScore,
        difficulty: p.contest.difficulty,
      })),
      aiExamResults: aiExams.slice(0, 10).map(e => ({
        subject: e.subject,
        difficulty: e.difficulty,
        score: e.score,
        total: e.totalMarks,
        percentage: Math.round((e.score / e.totalMarks) * 100),
      })),
      subjectsPerformance: (report?.subjectsPerformance || []).map(s => ({
        subject: s.name,
        grade: s.grade,
        classAvg: s.classAvg,
      })),
    };

    const systemPrompt = `أنت محلل تعليمي خبير. قم بتحليل بيانات أداء الطالب التالية وقدم تقريراً شاملاً باللغة العربية الفصحى.

يجب أن يكون الرد بصيغة JSON فقط:
{
  "overallAssessment": "تقييم عام للأداء",
  "strengths": ["نقطة قوة 1", "نقطة قوة 2"],
  "weaknesses": ["نقطة ضعف 1", "نقطة ضعف 2"],
  "weakLessons": ["اسم الدرس الضعيف 1", "اسم الدرس الضعيف 2"],
  "topicsToStudy": ["موضوع للمذاكرة 1", "موضوع للمذاكرة 2"],
  "advice": "نصيحة واحدة شاملة",
  "improvements": ["تحسين 1", "تحسين 2"],
  "studyPlan": "خطة دراسية مفصلة ومقسمة على أيام الأسبوع",
  "motivationalMessage": "رسالة تحفيزية مخصصة"
}

⚠️ تنبيه مهم: كل حقل يجب أن يكون بنفس النوع المحدد أعلاه بالضبط. weakLessons و topicsToStudy هما مصفوفة من النصوص فقط (نصوص وليس objects). advice هو نص واحد وليس مصفوفة. studyPlan هو نص واحد وليس object.`;

    const userPrompt = `قم بتحليل أداء الطالب التالي:

الاسم: ${promptData.studentName}
الصف: ${promptData.gradeLevel || 'غير محدد'}
التخصص: ${promptData.stream || 'غير محدد'}

=== إحصائيات عامة ===
متوسط درجات الاختبارات: ${promptData.overallStats.avgExamScore}%
متوسط مسابقات IQ: ${promptData.overallStats.avgContestScore}%
متوسط اختبارات AI: ${promptData.overallStats.avgAiExamScore}%
عدد الاختبارات: ${promptData.overallStats.totalExamsTaken}
عدد المسابقات: ${promptData.overallStats.totalContests}
عدد اختبارات AI: ${promptData.overallStats.totalAiExams}

=== نقاط القوة ===
${JSON.stringify(promptData.strengths, null, 2)}

=== نقاط الضعف ===
${JSON.stringify(promptData.weaknesses, null, 2)}

=== المواد والدرجات ===
${JSON.stringify(promptData.subjectsPerformance, null, 2)}

=== آخر الاختبارات ===
${JSON.stringify(promptData.recentExams, null, 2)}

=== الواجبات الأخيرة ===
${JSON.stringify(promptData.recentAssignments, null, 2)}

=== نتائج المسابقات ===
${JSON.stringify(promptData.contestResults, null, 2)}

=== نتائج اختبارات AI ===
${JSON.stringify(promptData.aiExamResults, null, 2)}

قدم تحليلاً شاملاً بناءً على هذه البيانات فقط. تأكد من أن JSON الناتج يطابق بالضبط النوع المحدد لكل حقل (نصوص وليست objects للقوائم، ونص واحد وليس مصفوفة للحقول النصية المفردة).`;

    const client = createGroqClient();

    try {
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = completion?.choices?.[0]?.message?.content || '';
      let analysis;
      try {
        analysis = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try { analysis = JSON.parse(match[0]); } catch { analysis = null; }
        } else {
          analysis = null;
        }
      }

      if (!analysis) {
        throw new Error('AI returned unparseable response');
      }

      return {
        analyzedAt: new Date().toISOString(),
        summary: promptData.overallStats,
        ...analysis,
      };
    } catch (error) {
      console.error('❌ Student AI Analysis error:', error.message);
      throw new Error(error.message || 'فشل تحليل الأداء بالذكاء الاصطناعي');
    }
  }
}

export default new StudentsService();
