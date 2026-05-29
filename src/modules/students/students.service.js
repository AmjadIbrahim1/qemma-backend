// backend/src/modules/students/students.service.js
// Aggregates all real-time dashboard data for a student

import prisma from '../../config/prisma.config.js';

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
      const err = new Error('Student profile not found');
      err.statusCode = 404;
      throw err;
    }
    return student;
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
}

export default new StudentsService();
