// backend/src/modules/parents/parents.service.js
// Service for parent-specific operations: fetching children's data

import prisma from '../../config/prisma.config.js';
import studentsService from '../students/students.service.js';
import notificationsService from '../notifications/notifications.service.js';

class ParentsService {

  // ── Helper: get parent record with children ───────────────────
  async _getParent(userId) {
    const parent = await prisma.parent.findUnique({
      where: { userId },
      include: {
        children: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, avatar: true, username: true },
            },
          },
        },
      },
    });

    if (!parent) {
      const err = new Error('Parent profile not found');
      err.statusCode = 404;
      throw err;
    }

    return parent;
  }

  // ── Helper: verify child belongs to this parent ───────────────
  _verifyChild(parent, childId) {
    const child = parent.children.find(c => c.id === childId);
    if (!child) {
      const err = new Error('Child not found or not linked to this parent');
      err.statusCode = 404;
      throw err;
    }
    return child;
  }

  // ── GET /api/parents/children ─────────────────────────────────
  async getChildren(userId) {
    const parent = await this._getParent(userId);

    if (!parent.children || parent.children.length === 0) {
      return [];
    }

    const enrichedChildren = await Promise.all(
      parent.children.map(async (child) => {
        try {
          const dashboard = await studentsService.getStudentDashboard(child.userId);
          return {
            id:              child.id,
            userId:          child.userId,
            name:            child.user?.name || '',
            email:           child.user?.email || '',
            phone:           child.user?.phone || '',
            avatar:          child.user?.avatar || '',
            username:        child.user?.username || '',
            gradeLevel:      child.gradeLevel || '',
            stream:          child.stream || '',
            kpis:            dashboard.kpis || [],
            stats:           dashboard.stats || {},
            enrolledCourses: dashboard.enrolledCourses || [],
            recentExams:     dashboard.recentExams || [],
            tasks:           dashboard.tasks || [],
            strengths:       dashboard.strengths || [],
            weaknesses:      dashboard.weaknesses || [],
            alerts:          dashboard.alerts || [],
            notifications:   (dashboard.notifications || []).slice(0, 5),
            overallProgress: dashboard.student?.overallProgress || 0,
          };
        } catch (err) {
          console.error('Failed to load dashboard for child:', child.id, err.message);
          return {
            id:         child.id,
            userId:     child.userId,
            name:       child.user?.name || 'Unknown',
            email:      child.user?.email || '',
            phone:      child.user?.phone || '',
            avatar:     child.user?.avatar || '',
            username:   child.user?.username || '',
            gradeLevel: child.gradeLevel || '',
            stream:     child.stream || '',
            kpis:       [],
            stats:      {},
          };
        }
      }),
    );

    return enrichedChildren;
  }

  // ── GET /api/parents/children/:childId/summary ────────────────
  async getChildSummary(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    try {
      const dashboard = await studentsService.getStudentDashboard(child.userId);
      return {
        id:                   child.id,
        userId:               child.userId,
        name:                 child.user?.name || '',
        avatar:               child.user?.avatar || '',
        gradeLevel:           child.gradeLevel || '',
        stream:               child.stream || '',
        overallProgress:      dashboard.student?.overallProgress || 0,
        kpis:                 dashboard.kpis || [],
        stats:                dashboard.stats || {},
        enrolledCoursesCount: (dashboard.enrolledCourses || []).length,
        recentExams:          (dashboard.recentExams || []).slice(0, 3),
        strengths:            (dashboard.strengths || []).slice(0, 3),
        weaknesses:           (dashboard.weaknesses || []).slice(0, 3),
        alerts:               (dashboard.alerts || []).slice(0, 3),
      };
    } catch (err) {
      return {
        id:         child.id,
        userId:     child.userId,
        name:       child.user?.name || '',
        avatar:     child.user?.avatar || '',
        gradeLevel: child.gradeLevel || '',
        stream:     child.stream || '',
      };
    }
  }

  // ── GET /api/parents/children/:childId/dashboard ──────────────
  async getChildDashboard(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);
    return studentsService.getStudentDashboard(child.userId);
  }

  // ── GET /api/parents/children/:childId/performance ────────────
  async getChildPerformance(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);
    return studentsService.getPerformanceReport(child.userId);
  }

  // ── GET /api/parents/children/:childId/tasks ──────────────────
  async getChildTasks(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);
    return studentsService.getStudentTasks(child.userId);
  }

  // ── GET /api/parents/children/:childId/exam-results ───────────
  async getChildExamResults(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    const examAttempts = await prisma.examAttempt.findMany({
      where: {
        studentId:   child.id,
        submittedAt: { not: null },
      },
      include: {
        exam: {
          select: {
            id:          true,
            title:       true,
            totalMarks:  true,
            passingMarks: true,
            course:  { select: { id: true, title: true } },
            teacher: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return examAttempts.map(a => ({
      id:          a.id,
      examId:      a.examId,
      examTitle:   a.exam.title,
      courseId:    a.exam.course?.id || '',
      courseTitle: a.exam.course?.title || '',
      teacherName: a.exam.teacher?.user?.name || '',
      score:       a.score,
      totalMarks:  a.exam.totalMarks,
      percentage:  a.score && a.exam.totalMarks > 0
        ? Math.round((a.score / a.exam.totalMarks) * 100)
        : 0,
      isPassed:    a.isPassed,
      submittedAt: a.submittedAt,
      finishedAt:  a.finishedAt,
    }));
  }

  // ── GET /api/parents/children/:childId/courses ────────────────
  async getChildCourses(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: child.id },
      include: {
        course: {
          include: {
            teacher: {
              include: { user: { select: { name: true, avatar: true } } },
            },
            _count: { select: { lessons: true, exams: true, assignments: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    return enrollments.map(e => ({
      id:          e.course.id,
      title:       e.course.title,
      description: e.course.description,
      thumbnail:   e.course.thumbnail,
      progress:    e.progress,
      enrolledAt:  e.enrolledAt,
      teacher: {
        name:   e.course.teacher?.user?.name || '',
        avatar: e.course.teacher?.user?.avatar || null,
      },
      stats: {
        lessons:     e.course._count.lessons,
        exams:       e.course._count.exams,
        assignments: e.course._count.assignments,
      },
    }));
  }

  // ── GET /api/parents/children/:childId/courses/:courseId ──────
  async getChildCourseDetails(userId, childId, courseId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: child.id, courseId } },
      include: {
        course: {
          include: {
            teacher: {
              include: { user: { select: { name: true, avatar: true } } },
            },
            _count: { select: { lessons: true, exams: true, assignments: true } },
          },
        },
      },
    });

    if (!enrollment) {
      const err = new Error('Child is not enrolled in this course');
      err.statusCode = 404;
      throw err;
    }

    const assignments = await prisma.assignment.findMany({
      where: { courseId, isPublished: true },
      include: {
        submissions: {
          where:  { studentId: child.id },
          select: { id: true, score: true, submittedAt: true, feedback: true, fileUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const exams = await prisma.exam.findMany({
      where: { courseId, isPublished: true },
      include: {
        attempts: {
          where:  { studentId: child.id },
          select: { id: true, score: true, isPassed: true, submittedAt: true },
        },
        _count: { select: { questions: true } },
      },
      orderBy: { availableFrom: 'asc' },
    });

    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: child.id,
        lesson:    { courseId },
      },
      include: {
        lesson: { select: { id: true, title: true, order: true } },
      },
      orderBy: { attendDate: 'desc' },
    });

    const grades = await prisma.grade.findMany({
      where: {
        studentId: child.id,
        exam:      { courseId },
      },
      include: {
        exam: { select: { id: true, title: true, totalMarks: true } },
      },
      orderBy: { gradedAt: 'desc' },
    });

    const liveSessions = await prisma.webrtcRoom.findMany({
      where:   { courseId },
      orderBy: [{ isActive: 'desc' }, { scheduledAt: 'desc' }],
      select: {
        id:          true,
        title:       true,
        roomName:    true,
        isActive:    true,
        scheduledAt: true,
        startedAt:   true,
        endedAt:     true,
      },
    });

    const schedules = await prisma.schedule.findMany({
      where:   { courseId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id:          true,
        title:       true,
        date:        true,
        startTime:   true,
        endTime:     true,
        meetingLink: true,
      },
    });

    const totalSessions   = attendances.length;
    const attendedSessions = attendances.filter(a => a.present).length;
    const attendanceRate  = totalSessions > 0
      ? Math.round((attendedSessions / totalSessions) * 100)
      : 0;

    const gradedExams = exams.filter(e => e.attempts.length > 0 && e.attempts[0].score !== null);
    const avgGrade    = gradedExams.length > 0
      ? Math.round(
          gradedExams.reduce((sum, e) => {
            const score = e.attempts[0].score || 0;
            return sum + ((score / e.totalMarks) * 100);
          }, 0) / gradedExams.length,
        )
      : 0;

    const pendingAssignments = assignments.filter(a => a.submissions.length === 0).length;

    return {
      course: {
        id:          enrollment.course.id,
        title:       enrollment.course.title,
        description: enrollment.course.description,
        thumbnail:   enrollment.course.thumbnail,
        teacher: {
          name:   enrollment.course.teacher?.user?.name || '',
          avatar: enrollment.course.teacher?.user?.avatar || null,
        },
        stats: {
          lessons:     enrollment.course._count.lessons,
          exams:       enrollment.course._count.exams,
          assignments: enrollment.course._count.assignments,
        },
      },
      progress: enrollment.progress,
      attendance: {
        rate:             attendanceRate,
        totalSessions,
        attendedSessions,
        records: attendances.map(a => ({
          id:           a.id,
          date:         a.attendDate,
          lessonTitle:  a.lesson?.title || '',
          present:      a.present,
        })),
      },
      assignments: assignments.map(a => ({
        id:          a.id,
        title:       a.title,
        description: a.description,
        dueDate:     a.dueDate,
        maxScore:    a.maxScore,
        submitted:   a.submissions.length > 0,
        submission:  a.submissions[0] || null,
        status:      a.submissions.length > 0
          ? (a.submissions[0].score !== null ? 'graded' : 'submitted')
          : (a.dueDate && new Date(a.dueDate) < new Date() ? 'late' : 'pending'),
      })),
      exams: exams.map(e => ({
        id:             e.id,
        title:          e.title,
        totalMarks:     e.totalMarks,
        passingMarks:   e.passingMarks,
        availableFrom:  e.availableFrom,
        availableTo:    e.availableTo,
        questionsCount: e._count.questions,
        attempt:        e.attempts[0] || null,
        status:         e.attempts.length > 0
          ? (e.attempts[0].score !== null ? 'completed' : 'in_progress')
          : (e.availableTo && new Date(e.availableTo) < new Date() ? 'missed' : 'upcoming'),
      })),
      grades: grades.map(g => ({
        id:          g.id,
        examTitle:   g.exam?.title || '',
        score:       g.score,
        totalMarks:  g.exam?.totalMarks || 0,
        gradeLetter: g.gradeLetter,
        gradedAt:    g.gradedAt,
      })),
      liveSessions: liveSessions.map(s => ({
        id:          s.id,
        title:       s.title,
        isLive:      s.isActive && s.startedAt && !s.endedAt,
        upcoming:    !s.isActive && s.scheduledAt && new Date(s.scheduledAt) > new Date(),
        scheduledAt: s.scheduledAt,
        startedAt:   s.startedAt,
        endedAt:     s.endedAt,
      })),
      schedules: schedules.map(s => ({
        id:          s.id,
        title:       s.title,
        date:        s.date,
        startTime:   s.startTime,
        endTime:     s.endTime,
        meetingLink: s.meetingLink,
      })),
      avgGrade,
      totalExams: exams.length,
      pendingAssignments,
    };
  }

  // ── GET /api/parents/children/:childId/books ─────────────────
  async getChildBooks(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    const purchases = await prisma.bookPurchase.findMany({
      where:   { studentId: child.id },
      include: {
        book: {
          select: {
            id:          true,
            title:       true,
            description: true,
            subject:     true,
            grade:       true,
            price:       true,
            coverImage:  true,
            createdAt:   true,
            teacher: {
              select: { user: { select: { name: true, avatar: true } } },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });

    return purchases.map(p => ({
      id:            p.id,
      paidAt:        p.paidAt,
      bookId:        p.book.id,
      title:         p.book.title,
      description:   p.book.description,
      subject:       p.book.subject,
      grade:         p.book.grade,
      price:         p.book.price,
      coverImage:    p.book.coverImage,
      teacherName:   p.book.teacher?.user?.name || '',
      teacherAvatar: p.book.teacher?.user?.avatar || null,
    }));
  }

  // ── GET /api/parents/children/:childId/notifications ──────────
  async getChildNotifications(userId, childId) {
    const parent = await this._getParent(userId);
    const child  = this._verifyChild(parent, childId);

    return notificationsService.getForUser(child.userId, { page: 1, limit: 50 });
  }

  // ── POST /api/parents/link-child ───────────────────────────────
  // Link a student to the authenticated parent (after OTP verification)
  async linkChild(userId, studentUsername) {
    if (!studentUsername || !studentUsername.trim()) {
      const err = new Error('اسم المستخدم للطالب مطلوب');
      err.statusCode = 400;
      throw err;
    }

    // Get parent record
    const parent = await prisma.parent.findUnique({ where: { userId } });
    if (!parent) {
      const err = new Error('لم يتم العثور على حساب ولي الأمر');
      err.statusCode = 404;
      throw err;
    }

    // Find the student user
    const studentUser = await prisma.user.findUnique({
      where:  { username: studentUsername.trim() },
      select: { id: true, name: true, role: true },
    });

    if (!studentUser) {
      const err = new Error('لم يتم العثور على طالب بهذا الاسم المميز');
      err.statusCode = 404;
      throw err;
    }

    if (studentUser.role !== 'student') {
      const err = new Error('هذا المستخدم ليس طالباً');
      err.statusCode = 400;
      throw err;
    }

    // Find the student record
    const studentRecord = await prisma.student.findUnique({
      where: { userId: studentUser.id },
    });

    if (!studentRecord) {
      const err = new Error('لم يتم العثور على سجل الطالب');
      err.statusCode = 404;
      throw err;
    }

    // Check if already linked to this parent
    if (studentRecord.parentId === parent.id) {
      return {
        alreadyLinked: true,
        child: {
          id:   studentRecord.id,
          name: studentUser.name,
        },
      };
    }

    // Check if linked to another parent
    if (studentRecord.parentId) {
      const err = new Error('هذا الطالب مرتبط بالفعل بولي أمر آخر');
      err.statusCode = 409;
      throw err;
    }

    // Link the student to this parent
    await prisma.student.update({
      where: { id: studentRecord.id },
      data:  { parentId: parent.id },
    });

    console.log('✅ Parent linked to student via add-child. Parent:', parent.id, 'Student:', studentRecord.id);

    return {
      alreadyLinked: false,
      child: {
        id:   studentRecord.id,
        name: studentUser.name,
      },
    };
  }
}

export default new ParentsService();