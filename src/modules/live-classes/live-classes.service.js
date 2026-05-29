// backend/src/modules/live-classes/live-classes.service.js

import prisma from '../../config/prisma.config.js';
import { getIO } from '../../socket/socket.config.js';
import crypto from 'crypto';

class LiveClassesService {

  _generateRoomId() { return 'room_' + crypto.randomBytes(6).toString('hex'); }

  /**
   * Room code = last 6 hex characters of the room name (uppercase).
   * IMPORTANT: joinRoomByCode uses the same slice logic, so they MUST match.
   */
  _roomCode(roomName) { return roomName.slice(-6).toUpperCase(); }

  // ── إنشاء غرفة جديدة ─────────────────────────────────────────────────
  async createRoom({
    teacherUserId, courseId, title, description,
    maxCapacity, scheduledTime,
    enableChat, enableScreenShare, recordSession, waitingRoom
  }) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
      include: { user: { select: { name: true } } },
    });
    if (!teacher) {
      const err = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    if (courseId) {
      const course = await prisma.course.findFirst({
        where: { id: courseId, teacherId: teacher.id },
      });
      if (!course) {
        const err = new Error('Course not found or not yours');
        err.statusCode = 403;
        throw err;
      }
    }

    // تحقق إذا في غرفة نشطة مسبقاً لنفس المدرس
    const existingActive = await prisma.webrtcRoom.findFirst({
      where: { hostId: teacher.id, isActive: true },
    });
    if (existingActive) {
      const err = new Error('لديك حصة نشطة بالفعل. أنهِ الحصة الحالية أولاً.');
      err.statusCode = 400;
      throw err;
    }

    const roomName = this._generateRoomId();
    const roomCode = this._roomCode(roomName);

    const room = await prisma.webrtcRoom.create({
      data: {
        roomName,
        courseId:     courseId || null,
        hostId:       teacher.id,
        roomType:     'live_class',
        isActive:     !scheduledTime, // if scheduled, not active immediately
        maxCapacity:  maxCapacity ? parseInt(maxCapacity) : 100,
        startedAt:    scheduledTime ? null : new Date(), // only start now if not scheduled
        title:        title || '',
        description:  description || '',
        scheduledAt:  scheduledTime ? new Date(scheduledTime) : null,
      },
      include: {
        course: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });

    // إشعار الطلاب المسجلين (فقط إذا كانت البث مباشراً وليس مجدول)
    if (courseId && !scheduledTime) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { student: { select: { userId: true } } },
      });

      let io;
      try { io = getIO(); } catch (_) { io = null; }

      const notifPayload = {
        type:        'live_class',
        title:       `📡 حصة مباشرة: ${title}`,
        body:        `المدرس ${teacher.user?.name || ''} بدأ حصة مباشرة. انضم الآن!\nكود الانضمام: ${roomCode}`,
        roomCode,
        roomId:      room.id,
        roomName:    room.roomName,
        courseTitle: room.course?.title || '',
      };

      for (const e of enrollments) {
        if (io) {
          io.to(`user:${e.student.userId}`).emit('live_class:started', notifPayload);
          io.to(`user:${e.student.userId}`).emit('notification:new', {
            id:        null,
            type:      'live_class',
            title:     notifPayload.title,
            body:      notifPayload.body,
            data:      { roomCode, roomId: room.id, roomName: room.roomName },
            isRead:    false,
            createdAt: new Date().toISOString(),
          });
        }

        try {
          await prisma.notification.create({
            data: {
              userId: e.student.userId,
              type:   'live_class',
              title:  notifPayload.title,
              body:   notifPayload.body,
              data:   {
                roomCode,
                roomId:       room.id,
                roomName:     room.roomName,
                senderUserId: teacherUserId,
              },
            },
          });
        } catch (_) {}
      }
    }

    // If scheduled, also send a notification about the upcoming live class
    if (courseId && scheduledTime) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { student: { select: { userId: true } } },
      });

      const scheduledDate = new Date(scheduledTime);
      const dateStr = scheduledDate.toLocaleDateString('ar-EG', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      const timeStr = scheduledDate.toLocaleTimeString('ar-EG', {
        hour: '2-digit', minute: '2-digit',
      });

      for (const e of enrollments) {
        try {
          await prisma.notification.create({
            data: {
              userId: e.student.userId,
              type:   'live_class_scheduled',
              title:  `📅 حصة مباشرة مجدولة: ${title}`,
              body:   `تم جدولة حصة مباشرة في ${dateStr} الساعة ${timeStr}`,
              data:   {
                roomId:    room.id,
                roomName:  room.roomName,
                courseId,
                scheduledAt: scheduledTime,
              },
            },
          });
        } catch (_) {}
      }
    }

    return {
      ...room,
      roomCode,
      roomLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/live/${room.roomName}`,
      title:             title       || '',
      description:       description || '',
      enableChat:        enableChat        ?? true,
      enableScreenShare: enableScreenShare ?? true,
      recordSession:     recordSession     ?? false,
      waitingRoom:       waitingRoom       ?? false,
      scheduledTime:     scheduledTime     || null,
    };
  }

  // ── إنهاء غرفة + حفظ تلقائي كدرس ───────────────────────────────────
  async endRoom(roomId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });

    const room = await prisma.webrtcRoom.findFirst({
      where:   { id: roomId, hostId: teacher?.id },
      include: { course: { select: { id: true, title: true } } },
    });

    if (!room) {
      const err = new Error('Room not found or not yours');
      err.statusCode = 404;
      throw err;
    }

    const endedAt       = new Date();
    const startedAt     = room.startedAt || room.createdAt;
    const durationMinutes = Math.round((endedAt - startedAt) / 60000);

    await prisma.webrtcRoom.update({
      where: { id: roomId },
      data:  { isActive: false, endedAt },
    });

    // حفظ تلقائي كدرس إذا كانت الغرفة مرتبطة بكورس
    let savedLesson = null;
    if (room.courseId) {
      try {
        const lessonsCount = await prisma.lesson.count({
          where: { courseId: room.courseId },
        });

        const lessonTitle = `حصة مباشرة مسجلة — ${new Date(startedAt).toLocaleDateString('ar-EG', {
          day: 'numeric', month: 'long', year: 'numeric',
        })}`;

        savedLesson = await prisma.lesson.create({
          data: {
            courseId:    room.courseId,
            title:       lessonTitle,
            content:     `حصة مباشرة مدتها ${durationMinutes} دقيقة`,
            summary:     `حصة لايف انتهت في ${endedAt.toLocaleTimeString('ar-EG')}`,
            order:       lessonsCount + 1,
            isPublished: true,
          },
        });
      } catch (lessonErr) {
        console.error('⚠️ Could not auto-save lesson:', lessonErr.message);
      }
    }

    // إشعار المشاركين بانتهاء الحصة
    try {
      const io = getIO();
      io.to(`room:${room.roomName}`).emit('live_class:ended', { roomId });

      // Send per-user status updates to enrolled students
      if (room.courseId) {
        const enrollments = await prisma.enrollment.findMany({
          where: { courseId: room.courseId },
          include: { student: { select: { userId: true } } },
        });
        for (const e of enrollments) {
          io.to(`user:${e.student.userId}`).emit('live_class:room_status_changed', {
            roomId:   room.id,
            roomName: room.roomName,
            isActive: false,
            endedAt:  endedAt.toISOString(),
            status:   'ended',
          });
        }
      }
    } catch (_) {}

    return {
      ended: true,
      roomId,
      durationMinutes,
      savedLesson: savedLesson ? {
        id:       savedLesson.id,
        title:    savedLesson.title,
        courseId: room.courseId,
      } : null,
    };
  }

  // ── جلب غرف المدرس ───────────────────────────────────────────────────
  async getTeacherRooms(teacherUserId, { page = 1, limit = 10 } = {}) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) return { rooms: [], pagination: {} };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [rooms, total] = await Promise.all([
      prisma.webrtcRoom.findMany({
        where:   { hostId: teacher.id },
        skip,
        take:    parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          course: { select: { title: true } },
          _count: { select: { participants: true } },
        },
      }),
      prisma.webrtcRoom.count({ where: { hostId: teacher.id } }),
    ]);

    return {
      rooms,
      pagination: {
        page:       parseInt(page),
        limit:      parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  // ── الغرفة النشطة الحالية للمدرس ────────────────────────────────────
  async getActiveRoom(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) return null;

    return prisma.webrtcRoom.findFirst({
      where:   { hostId: teacher.id, isActive: true },
      include: {
        course: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });
  }

  // ── كورسات المدرس ────────────────────────────────────────────────────
  async getTeacherCourses(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) return [];

    return prisma.course.findMany({
      where:  { teacherId: teacher.id },
      select: {
        id:    true,
        title: true,
        isPublished: true,
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── إحصائيات الغرف ───────────────────────────────────────────────────
  async getRoomStats(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) return { total: 0, active: 0, totalParticipants: 0 };

    const [total, active, totalParticipants] = await Promise.all([
      prisma.webrtcRoom.count({ where: { hostId: teacher.id } }),
      prisma.webrtcRoom.count({ where: { hostId: teacher.id, isActive: true } }),
      prisma.webrtcParticipant.count({ where: { room: { hostId: teacher.id } } }),
    ]);

    return { total, active, totalParticipants };
  }

  // ── تفاصيل كورس (للمدرس) ────────────────────────────────────────────
  async getCourseDetails(courseId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 403 });

    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id },
    });
    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

    const [students, liveRooms, lessons, exams] = await Promise.all([
      prisma.enrollment.findMany({
        where:   { courseId },
        include: {
          student: {
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true } },
            },
          },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      prisma.webrtcRoom.findMany({
        where:   { courseId, isActive: false },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { participants: true } } },
      }),
      prisma.lesson.findMany({
        where:   { courseId },
        orderBy: { order: 'asc' },
      }),
      prisma.exam.findMany({
        where:   { courseId },
        include: { _count: { select: { attempts: true, questions: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      course,
      students: students.map(e => ({
        enrollmentId: e.id,
        enrolledAt:   e.enrolledAt,
        progress:     e.progress,
        student: {
          id:     e.student.id,
          userId: e.student.userId,
          name:   e.student.user.name,
          email:  e.student.user.email,
          avatar: e.student.user.avatar,
        },
      })),
      liveRooms: liveRooms.map(r => ({
        id:              r.id,
        roomName:        r.roomName,
        startedAt:       r.startedAt,
        endedAt:         r.endedAt,
        durationMinutes: r.startedAt && r.endedAt
          ? Math.round((new Date(r.endedAt) - new Date(r.startedAt)) / 60000)
          : null,
        participants: r._count.participants,
      })),
      lessons,
      exams: exams.map(e => ({
        id:             e.id,
        title:          e.title,
        isPublished:    e.isPublished,
        totalMarks:     e.totalMarks,
        passingMarks:   e.passingMarks,
        createdAt:      e.createdAt,
        questionsCount: e._count.questions,
        attemptsCount:  e._count.attempts,
      })),
    };
  }

  // ── انضمام طالب لغرفة عبر الكود ─────────────────────────────────────
  async joinRoomByCode(roomCode, studentUserId) {
    // الكود هو آخر 6 أحرف من اسم الغرفة بالـ uppercase
    const rooms = await prisma.webrtcRoom.findMany({
      where:   { isActive: true },
      include: {
        course: { select: { title: true } },
        host:   { include: { user: { select: { name: true } } } },
        _count: { select: { participants: true } },
      },
    });

    const room = rooms.find(r =>
      r.roomName.slice(-6).toUpperCase() === roomCode.toUpperCase()
    );

    if (!room) {
      const err = new Error('الغرفة غير موجودة أو انتهت');
      err.statusCode = 404;
      throw err;
    }

    if (room.maxCapacity && room._count.participants >= room.maxCapacity) {
      const err = new Error('الغرفة ممتلئة');
      err.statusCode = 400;
      throw err;
    }

    return {
      roomId:      room.id,
      roomName:    room.roomName,
      courseTitle: room.course?.title || '',
      teacherName: room.host?.user?.name || '',
      roomCode,
    };
  }

  // ── بدء غرفة مجدولة (تنشيطها) ────────────────────────────────────────────
  async startRoom(roomId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) {
      const err = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    const room = await prisma.webrtcRoom.findFirst({
      where: { id: roomId, hostId: teacher.id },
      include: {
        course: { select: { id: true, title: true } },
        _count: { select: { participants: true } },
      },
    });
    if (!room) {
      const err = new Error('الغرفة غير موجودة');
      err.statusCode = 404;
      throw err;
    }

    if (room.isActive && room.startedAt) {
      // Already active — return as-is
      return {
        ...room,
        roomCode: room.roomName.slice(-6).toUpperCase(),
        alreadyActive: true,
      };
    }

    // Activate the room
    const now = new Date();
    const updated = await prisma.webrtcRoom.update({
      where: { id: roomId },
      data: {
        isActive:    true,
        startedAt:   now,
        scheduledAt: null, // clear scheduled time since it's now live
      },
      include: {
        course: { select: { id: true, title: true } },
        _count: { select: { participants: true } },
      },
    });

    // إشعار الطلاب المسجلين أن الحصة بدأت الآن
    if (room.courseId) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId: room.courseId },
        include: { student: { select: { userId: true } } },
      });

      let io;
      try { io = getIO(); } catch (_) { io = null; }

      const roomCode = room.roomName.slice(-6).toUpperCase();
      const notifPayload = {
        type:        'live_class',
        title:       `📡 حصة مباشرة: ${room.title}`,
        body:        `المدرس ${teacher.user?.name || ''} بدأ الحصة المباشرة الآن! انضم فوراً!\nكود الانضمام: ${roomCode}`,
        roomCode,
        roomId:      room.id,
        roomName:    room.roomName,
        courseTitle: updated.course?.title || '',
      };

      for (const e of enrollments) {
        if (io) {
          io.to(`user:${e.student.userId}`).emit('live_class:started', notifPayload);
          io.to(`user:${e.student.userId}`).emit('notification:new', {
            id:        null,
            type:      'live_class',
            title:     notifPayload.title,
            body:      notifPayload.body,
            data:      { roomCode, roomId: room.id, roomName: room.roomName },
            isRead:    false,
            createdAt: now.toISOString(),
          });
        }

        try {
          await prisma.notification.create({
            data: {
              userId: e.student.userId,
              type:   'live_class',
              title:  notifPayload.title,
              body:   notifPayload.body,
              data:   {
                roomCode,
                roomId:       room.id,
                roomName:     room.roomName,
                senderUserId: teacherUserId,
              },
            },
          });
        } catch (_) {}
      }

      // Broadcast room status change to enrolled students' user rooms
      if (io) {
        for (const e of enrollments) {
          io.to(`user:${e.student.userId}`).emit('live_class:room_status_changed', {
            roomId:    room.id,
            roomName:  room.roomName,
            title:     room.title,
            isActive:  true,
            startedAt: now.toISOString(),
            status:    'live',
          });
        }
      }
    }

    return {
      ...updated,
      roomCode: updated.roomName.slice(-6).toUpperCase(),
    };
  }

  // ── إلغاء غرفة مجدولة ─────────────────────────────────────────────────
  async cancelRoom(roomId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) {
      const err = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    const room = await prisma.webrtcRoom.findFirst({
      where: { id: roomId, hostId: teacher.id },
    });
    if (!room) {
      const err = new Error('الغرفة غير موجودة');
      err.statusCode = 404;
      throw err;
    }

    if (room.isActive) {
      const err = new Error('لا يمكن إلغاء حصة نشطة. أنهِ الحصة أولاً.');
      err.statusCode = 400;
      throw err;
    }

    // Delete the scheduled room
    await prisma.webrtcRoom.delete({
      where: { id: roomId },
    });

    return { cancelled: true, roomId };
  }

  // ── إحصائيات Dashboard المدرس ────────────────────────────────────────
  async getDashboardStats(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where:   { userId: teacherUserId },
      include: { courses: { select: { id: true, isPublished: true } } },
    });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 403 });

    const courseIds = teacher.courses.map(c => c.id);

    const [totalStudents, activeCourses, weeklyRooms, attendanceData] = await Promise.all([
      // إجمالي الطلاب المشتركين في كورسات المدرس (بدون تكرار)
      prisma.enrollment.findMany({
        where:  { courseId: { in: courseIds } },
        select: { studentId: true },
      }).then(e => new Set(e.map(x => x.studentId)).size),

      // الكورسات المنشورة
      prisma.course.count({
        where: { teacherId: teacher.id, isPublished: true },
      }),

      // الحصص هذا الأسبوع
      prisma.webrtcRoom.count({
        where: {
          hostId:    teacher.id,
          startedAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - 7)),
          },
        },
      }),

      // الحضور (نسبة مئوية)
      prisma.attendance.findMany({
        where: { lesson: { course: { teacherId: teacher.id } } },
        select: { present: true },
      }),
    ]);

    const totalAttendance = attendanceData.length;
    const presentCount    = attendanceData.filter(a => a.present).length;
    const attendanceRate  = totalAttendance > 0
      ? Math.round((presentCount / totalAttendance) * 100)
      : 0;

    return {
      totalStudents,
      activeCourses,
      weeklyClasses: weeklyRooms,
      attendanceRate: `${attendanceRate}%`,
    };
  }
}

export default new LiveClassesService();