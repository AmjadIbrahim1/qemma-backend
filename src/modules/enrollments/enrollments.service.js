// backend/src/modules/enrollments/enrollments.service.js
// FIX: exams now show regardless of isPublished (student sees published only via flag)
//      sessions pulled from BOTH course.schedules AND teacher.schedules for this course
//      notifications endpoint already works — no change needed there

import prisma from '../../config/prisma.config.js';

class EnrollmentsService {

  // ── التحقق من وجود student record ────────────────────────────
  async _getStudent(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) {
      const err = new Error('Student profile not found');
      err.statusCode = 404;
      throw err;
    }
    return student;
  }

  // ── جلب كل كورسات الطالب ─────────────────────────────────────
  async getStudentEnrollments(userId) {
    const student = await this._getStudent(userId);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      include: {
        course: {
          include: {
            teacher: {
              include: {
                user: { select: { id: true, name: true, avatar: true } },
              },
            },
            _count: { select: { lessons: true, enrollments: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    return enrollments.map((e) => this._formatEnrollment(e));
  }

  // ── جلب تفاصيل كورس محدد للطالب (مع كل المحتوى) ─────────────
  async getStudentCourseDetail(userId, courseId) {
    const student = await this._getStudent(userId);

    // التحقق من التسجيل
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: student.id, courseId } },
    });

    if (!enrollment) {
      const err = new Error('لم يتم التسجيل في هذا الكورس');
      err.statusCode = 403;
      throw err;
    }

    // جلب كل بيانات الكورس كاملة
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        lessons: {
          where: { isPublished: true },          // ✅ الطالب يشوف المنشور فقط
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            order: true,
            isPublished: true,
            videoUrl: true,
            summary: true,
            pdfFileRef: true,
            createdAt: true,
          },
        },
        exams: {
          // ✅ الطالب المسجل مدفوع — يشوف جميع الاختبارات (منشور + غير منشور)
          include: {
            _count: { select: { attempts: true, questions: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        // ✅ FIX: جلب الجلسات المرتبطة بالكورس مباشرةً من جدول schedules
        schedules: {
          where: {
            date: { gte: new Date(new Date().toDateString()) }, // من اليوم فصاعدًا
          },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        },
        _count: {
          select: { lessons: true, enrollments: true },
        },
      },
    });

    if (!course) {
      const err = new Error('الكورس غير موجود');
      err.statusCode = 404;
      throw err;
    }

    // ✅ FIX: جلب جلسات المدرس المرتبطة بنفس الكورس (fallback إضافي)
    // هذا يضمن إنهار تظهر حتى لو الـ relation لم تُجلب كاملةً فوق
    const teacherSchedules = await prisma.schedule.findMany({
      where: {
        courseId,
        date: { gte: new Date(new Date().toDateString()) },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    // دمج النتيجتين وإزالة التكرار بالـ id
    const allSchedulesMap = new Map();
    [...(course.schedules || []), ...teacherSchedules].forEach((s) => {
      allSchedulesMap.set(s.id, s);
    });
    const mergedSchedules = Array.from(allSchedulesMap.values()).sort(
      (a, b) => new Date(a.date) - new Date(b.date) || a.startTime.localeCompare(b.startTime)
    );

    // جلب اختبارات الطالب في هذا الكورس
    const examAttempts = await prisma.examAttempt.findMany({
      where: {
        studentId: student.id,
        exam: { courseId },
      },
      select: {
        examId: true,
        score: true,
        isPassed: true,
        submittedAt: true,
      },
    });

    // جلب حضور الطالب
    const attendances = await prisma.attendance.findMany({
      where: {
        studentId: student.id,
        lesson: { courseId },
      },
      select: { lessonId: true, present: true, attendDate: true },
    });

    const attendedLessonIds = new Set(
      attendances.filter((a) => a.present).map((a) => a.lessonId)
    );

    const attemptMap = {};
    examAttempts.forEach((a) => {
      attemptMap[a.examId] = a;
    });

    let meta = {};
    try { meta = JSON.parse(course.description || '{}'); } catch { meta = { text: course.description }; }

    // جلب الغرف المباشرة (webrtc rooms) لهذا الكورس
    const liveRooms = await prisma.webrtcRoom.findMany({
      where: { courseId },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        host: {
          include: {
            user: { select: { name: true } },
          },
        },
        _count: { select: { participants: true } },
      },
    });

    return {
      enrollment: {
        id:         enrollment.id,
        progress:   enrollment.progress,
        enrolledAt: enrollment.enrolledAt,
      },
      course: {
        id:          course.id,
        title:       course.title,
        description: meta.text ?? course.description ?? '',
        category:    meta.category ?? '',
        level:       meta.level ?? '',
        thumbnail:   course.thumbnail,
        price:       course.price,
        isPublished: course.isPublished,
        stats: {
          totalLessons:  course._count.lessons,
          totalStudents: course._count.enrollments,
          totalExams:    course.exams.length,
          attendedCount: attendedLessonIds.size,
        },
        teacher: {
          id:       course.teacher.id,
          userId:   course.teacher.userId,
          name:     course.teacher.user.name,
          avatar:   course.teacher.user.avatar,
          email:    course.teacher.user.email,
          phone:    course.teacher.user.phone,
          bio:      course.teacher.bio,
          verified: course.teacher.verified,
        },
        lessons: course.lessons.map((l) => ({
          ...l,
          attended: attendedLessonIds.has(l.id),
        })),
        // ✅ FIX: الامتحانات مع كل البيانات المطلوبة للـ ExamCard
        exams: course.exams.map((exam) => ({
          id:             exam.id,
          title:          exam.title,
          description:    exam.description,
          duration:       exam.duration,
          durationMinutes: exam.durationMinutes ?? exam.duration,
          totalMarks:     exam.totalMarks,
          passingMarks:   exam.passingMarks,
          availableFrom:  exam.availableFrom,
          availableTo:    exam.availableTo,
          isPublished:    exam.isPublished,
          questionsCount: exam._count.questions,
          attemptsCount:  exam._count.attempts,
          myAttempt:      attemptMap[exam.id] || null,
        })),
        // ✅ FIX: الجلسات المدمجة من كلا المصدرين
        upcomingSessions: mergedSchedules.map((s) => ({
          id:          s.id,
          title:       s.title,
          description: s.description,
          date:        s.date,
          startTime:   s.startTime,
          endTime:     s.endTime,
          type:        s.type,
          meetingLink: s.meetingLink,
          maxStudents: s.maxStudents,
        })),
        // ✅ الحصص المباشرة (WebRTC rooms) مع حالة كل منها
        liveRooms: liveRooms.map((r) => {
          const now = new Date();
          let status = 'ended';
          if (r.isActive && r.startedAt) {
            status = 'live';
          } else if (r.scheduledAt && new Date(r.scheduledAt) > now) {
            status = 'scheduled';
          } else if (r.isActive && !r.startedAt && r.scheduledAt && new Date(r.scheduledAt) <= now) {
            status = 'live';
          }
          return {
            id:               r.id,
            roomName:         r.roomName,
            title:            r.title || '',
            description:      r.description,
            status,
            isActive:         r.isActive,
            scheduledAt:      r.scheduledAt,
            startedAt:        r.startedAt,
            endedAt:          r.endedAt,
            maxCapacity:      r.maxCapacity,
            participantCount: r._count.participants,
            teacherName:      r.host?.user?.name || '',
            roomCode:         r.roomName.slice(-6).toUpperCase(),
          };
        }),
      },
    };
  }

  // ── تحديث تقدم الطالب ────────────────────────────────────────
  async updateProgress(userId, courseId, progress) {
    const student = await this._getStudent(userId);
    const updated = await prisma.enrollment.update({
      where: { studentId_courseId: { studentId: student.id, courseId } },
      data:  { progress: Math.min(100, Math.max(0, parseInt(progress))) },
    });
    return { progress: updated.progress };
  }

  // ── Helper ────────────────────────────────────────────────────
  _formatEnrollment(e) {
    const course = e.course;
    let meta = {};
    try { meta = JSON.parse(course.description || '{}'); } catch { meta = { text: course.description }; }

    return {
      enrollmentId: e.id,
      progress:     e.progress,
      enrolledAt:   e.enrolledAt,
      course: {
        id:          course.id,
        title:       course.title,
        description: meta.text ?? course.description ?? '',
        category:    meta.category ?? '',
        level:       meta.level ?? '',
        thumbnail:   course.thumbnail,
        price:       course.price,
        isPublished: course.isPublished,
        teacher: {
          id:     course.teacher.user.id,
          name:   course.teacher.user.name,
          avatar: course.teacher.user.avatar,
        },
        totalLessons:  course._count.lessons,
        studentsCount: course._count.enrollments,
      },
    };
  }
}

export default new EnrollmentsService();