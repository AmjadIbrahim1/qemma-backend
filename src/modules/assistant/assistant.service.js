// backend/src/modules/assistant/assistant.service.js
// Service for assistant teacher features:
//   - Get all students enrolled in the linked main teacher's courses
//   - Get student details with exam performance

import prisma from '../../config/prisma.config.js';

class AssistantService {

  // ─────────────────────────────────────────────────────────────
  // Helper: get the Teacher record for the logged-in assistant
  // ─────────────────────────────────────────────────────────────
  async _getAssistantTeacher(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: {
        id:              true,
        linkedTeacherId: true,
        specialties:     true,
        verified:        true,
        user: {
          select: { id: true, name: true, email: true, avatar: true, role: true },
        },
      },
    });

    if (!teacher) {
      const err = new Error('لم يتم العثور على بيانات المدرس المساعد');
      err.statusCode = 404;
      throw err;
    }

    if (teacher.user.role !== 'assistant_teacher') {
      const err = new Error('هذا الحساب ليس مدرساً مساعداً');
      err.statusCode = 403;
      throw err;
    }

    return teacher;
  }

  // ─────────────────────────────────────────────────────────────
  // Helper: resolve the linked main teacher ID
  // Returns null if not linked
  // ─────────────────────────────────────────────────────────────
  async _getLinkedMainTeacher(assistantTeacher) {
    if (!assistantTeacher.linkedTeacherId) return null;

    const mainTeacher = await prisma.teacher.findUnique({
      where: { id: assistantTeacher.linkedTeacherId },
      select: {
        id:         true,
        specialties: true,
        verified:   true,
        ratingAvg:  true,
        user: {
          select: {
            id:       true,
            name:     true,
            email:    true,
            avatar:   true,
            username: true,
          },
        },
      },
    });

    return mainTeacher;
  }

  // ─────────────────────────────────────────────────────────────
  // GET /api/assistant/students
  // Returns all students enrolled in the linked teacher's courses,
  // with per-student exam performance stats
  // ─────────────────────────────────────────────────────────────
  async getLinkedTeacherStudents(userId) {
    const assistant   = await this._getAssistantTeacher(userId);
    const mainTeacher = await this._getLinkedMainTeacher(assistant);

    if (!mainTeacher) {
      return {
        linkedTeacher: null,
        students:      [],
        courses:       [],
        stats: {
          totalStudents:   0,
          totalCourses:    0,
          totalEnrollments: 0,
        },
      };
    }

    // ── 1. Get all courses of the main teacher ─────────────────
    const courses = await prisma.course.findMany({
      where: { teacherId: mainTeacher.id },
      select: {
        id:          true,
        title:       true,
        isPublished: true,
        price:       true,
        createdAt:   true,
        _count: {
          select: { enrollments: true, lessons: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const courseIds = courses.map(c => c.id);

    if (courseIds.length === 0) {
      return {
        linkedTeacher: this._formatTeacher(mainTeacher),
        students:      [],
        courses:       courses.map(c => this._formatCourse(c)),
        stats: {
          totalStudents:    0,
          totalCourses:     courses.length,
          totalEnrollments: 0,
        },
      };
    }

    // ── 2. Get all enrollments with student data ───────────────
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        id:         true,
        courseId:   true,
        progress:   true,
        enrolledAt: true,
        student: {
          select: {
            id:         true,
            userId:     true,
            gradeLevel: true,
            stream:     true,
            coins:      true,
            user: {
              select: {
                id:       true,
                name:     true,
                email:    true,
                phone:    true,
                avatar:   true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // ── 3. Unique students with their enrolled courses ─────────
    const studentMap = new Map();

    for (const enrollment of enrollments) {
      const s    = enrollment.student;
      const sid  = s.id;

      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          id:         sid,
          userId:     s.userId,
          name:       s.user.name        || '',
          email:      s.user.email       || '',
          phone:      s.user.phone       || '',
          avatar:     s.user.avatar      || null,
          username:   s.user.username    || '',
          gradeLevel: s.gradeLevel       || '',
          stream:     s.stream           || '',
          coins:      s.coins            || 0,
          enrollments: [],
          avgProgress: 0,
          // exam stats filled below
          examAttempts:  0,
          avgScore:      null,
          passedExams:   0,
          failedExams:   0,
          lastActivity:  enrollment.enrolledAt,
        });
      }

      const entry = studentMap.get(sid);
      entry.enrollments.push({
        courseId:   enrollment.courseId,
        courseTitle: courses.find(c => c.id === enrollment.courseId)?.title || '',
        progress:   enrollment.progress,
        enrolledAt: enrollment.enrolledAt,
      });

      // Track most recent activity
      if (new Date(enrollment.enrolledAt) > new Date(entry.lastActivity)) {
        entry.lastActivity = enrollment.enrolledAt;
      }
    }

    // ── 4. Compute avg progress per student ────────────────────
    for (const student of studentMap.values()) {
      const total = student.enrollments.reduce((s, e) => s + e.progress, 0);
      student.avgProgress = student.enrollments.length > 0
        ? Math.round(total / student.enrollments.length)
        : 0;
    }

    // ── 5. Get exam attempts for all students in these courses ─
    const studentIds = Array.from(studentMap.keys());

    const attempts = await prisma.examAttempt.findMany({
      where: {
        studentId:   { in: studentIds },
        exam:        { courseId: { in: courseIds } },
        submittedAt: { not: null },
        score:       { not: null },
      },
      select: {
        studentId:   true,
        score:       true,
        isPassed:    true,
        submittedAt: true,
        exam: {
          select: {
            totalMarks: true,
            courseId:   true,
            title:      true,
          },
        },
      },
    });

    // Aggregate exam stats per student
    const examStatsMap = new Map();

    for (const attempt of attempts) {
      const sid = attempt.studentId;
      if (!examStatsMap.has(sid)) {
        examStatsMap.set(sid, { scores: [], passed: 0, failed: 0, lastAttempt: null });
      }
      const stats = examStatsMap.get(sid);
      if (attempt.exam.totalMarks > 0) {
        stats.scores.push((attempt.score / attempt.exam.totalMarks) * 100);
      }
      if (attempt.isPassed) stats.passed++;
      else stats.failed++;
      if (!stats.lastAttempt || new Date(attempt.submittedAt) > new Date(stats.lastAttempt)) {
        stats.lastAttempt = attempt.submittedAt;
      }
    }

    // Apply exam stats to student objects
    for (const student of studentMap.values()) {
      const stats = examStatsMap.get(student.id);
      if (stats) {
        student.examAttempts = stats.scores.length;
        student.avgScore     = stats.scores.length > 0
          ? Math.round(stats.scores.reduce((s, v) => s + v, 0) / stats.scores.length)
          : null;
        student.passedExams  = stats.passed;
        student.failedExams  = stats.failed;
        if (stats.lastAttempt && new Date(stats.lastAttempt) > new Date(student.lastActivity)) {
          student.lastActivity = stats.lastAttempt;
        }
      }
    }

    const students = Array.from(studentMap.values())
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    return {
      linkedTeacher: this._formatTeacher(mainTeacher),
      students,
      courses: courses.map(c => this._formatCourse(c)),
      stats: {
        totalStudents:    students.length,
        totalCourses:     courses.length,
        totalEnrollments: enrollments.length,
        publishedCourses: courses.filter(c => c.isPublished).length,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // GET /api/assistant/students/:studentId
  // Detailed info about a single student (for the assistant view)
  // ─────────────────────────────────────────────────────────────
  async getStudentDetail(userId, studentId) {
    const assistant   = await this._getAssistantTeacher(userId);
    const mainTeacher = await this._getLinkedMainTeacher(assistant);

    if (!mainTeacher) {
      const err = new Error('المدرس المساعد غير مرتبط بمدرس رئيسي');
      err.statusCode = 403;
      throw err;
    }

    // Verify the student is actually enrolled in one of the linked teacher's courses
    const courseIds = (await prisma.course.findMany({
      where:  { teacherId: mainTeacher.id },
      select: { id: true },
    })).map(c => c.id);

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId, courseId: { in: courseIds } },
    });

    if (!enrollment) {
      const err = new Error('هذا الطالب ليس مسجلاً في كورسات المدرس');
      err.statusCode = 403;
      throw err;
    }

    // Get student full data
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, phone: true,
            avatar: true, username: true, createdAt: true,
          },
        },
        enrollments: {
          where:   { courseId: { in: courseIds } },
          include: { course: { select: { id: true, title: true, price: true } } },
          orderBy: { enrolledAt: 'desc' },
        },
      },
    });

    if (!student) {
      const err = new Error('الطالب غير موجود');
      err.statusCode = 404;
      throw err;
    }

    // Exam attempts
    const attempts = await prisma.examAttempt.findMany({
      where: {
        studentId,
        exam:        { courseId: { in: courseIds } },
        submittedAt: { not: null },
      },
      include: {
        exam: {
          select: {
            id: true, title: true, totalMarks: true, passingMarks: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const gradedAttempts = attempts.filter(a => a.score !== null && a.exam.totalMarks > 0);
    const avgScore = gradedAttempts.length > 0
      ? Math.round(gradedAttempts.reduce((s, a) => s + (a.score / a.exam.totalMarks) * 100, 0) / gradedAttempts.length)
      : null;

    return {
      student: {
        id:         student.id,
        userId:     student.userId,
        name:       student.user.name     || '',
        email:      student.user.email    || '',
        phone:      student.user.phone    || '',
        avatar:     student.user.avatar   || null,
        username:   student.user.username || '',
        gradeLevel: student.gradeLevel    || '',
        stream:     student.stream        || '',
        coins:      student.coins         || 0,
        memberSince: student.user.createdAt,
        enrollments: student.enrollments.map(e => ({
          courseId:    e.course.id,
          courseTitle: e.course.title,
          progress:    e.progress,
          enrolledAt:  e.enrolledAt,
        })),
      },
      examSummary: {
        totalAttempts: attempts.length,
        gradedAttempts: gradedAttempts.length,
        avgScore,
        passedCount:  gradedAttempts.filter(a => a.isPassed).length,
        failedCount:  gradedAttempts.filter(a => a.isPassed === false).length,
      },
      recentAttempts: gradedAttempts.slice(0, 10).map(a => ({
        examId:      a.exam.id,
        examTitle:   a.exam.title,
        courseTitle: a.exam.course?.title || '',
        score:       Math.round((a.score / a.exam.totalMarks) * 100),
        rawScore:    a.score,
        totalMarks:  a.exam.totalMarks,
        isPassed:    a.isPassed,
        submittedAt: a.submittedAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // GET /api/assistant/info
  // Returns assistant's own info + linked teacher info
  // ─────────────────────────────────────────────────────────────
  async getAssistantInfo(userId) {
    const assistant   = await this._getAssistantTeacher(userId);
    const mainTeacher = await this._getLinkedMainTeacher(assistant);

    return {
      assistant: {
        id:          assistant.id,
        specialties: assistant.specialties,
        verified:    assistant.verified,
        name:        assistant.user.name,
        email:       assistant.user.email,
        avatar:      assistant.user.avatar,
      },
      linkedTeacher: mainTeacher ? this._formatTeacher(mainTeacher) : null,
      isLinked: !!mainTeacher,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Formatters
  // ─────────────────────────────────────────────────────────────
  _formatTeacher(teacher) {
    return {
      id:          teacher.id,
      userId:      teacher.user.id,
      name:        teacher.user.name,
      email:       teacher.user.email,
      avatar:      teacher.user.avatar,
      username:    teacher.user.username,
      specialties: teacher.specialties,
      verified:    teacher.verified,
      ratingAvg:   teacher.ratingAvg ? parseFloat(teacher.ratingAvg) : 0,
    };
  }

  _formatCourse(course) {
    return {
      id:           course.id,
      title:        course.title,
      isPublished:  course.isPublished,
      price:        course.price,
      studentsCount: course._count?.enrollments ?? 0,
      lessonsCount:  course._count?.lessons     ?? 0,
      createdAt:    course.createdAt,
    };
  }
}

export default new AssistantService();