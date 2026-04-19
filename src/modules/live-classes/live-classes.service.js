// backend/src/modules/live-classes/live-classes.service.js
// CHANGES:
//   • endRoom() يحفظ الحصة المنتهية تلقائياً كدرس في الكورس

import prisma from '../../config/prisma.config.js';
import { getIO } from '../../socket/socket.config.js';
import crypto from 'crypto';

class LiveClassesService {

  _generateRoomId()   { return 'room_' + crypto.randomBytes(6).toString('hex'); }
  _generateRoomCode() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }

  async createRoom({
    teacherUserId, courseId, title, description,
    maxCapacity, scheduledTime,
    enableChat, enableScreenShare, recordSession, waitingRoom
  }) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
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

    const roomName = this._generateRoomId();
    const roomCode = this._generateRoomCode();

    const room = await prisma.webrtcRoom.create({
      data: {
        roomName,
        courseId:    courseId || null,
        hostId:      teacher.id,
        roomType:    'live_class',
        isActive:    true,
        maxCapacity: maxCapacity ? parseInt(maxCapacity) : 100,
        startedAt:   new Date(),
      },
      include: {
        course: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });

    // Notify enrolled students
    if (courseId) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { student: { select: { userId: true } } },
      });

      const teacherUser = await prisma.user.findUnique({
        where: { id: teacherUserId },
        select: { name: true },
      });

      let io;
      try { io = getIO(); } catch (_) { io = null; }

      const notifPayload = {
        type:     'live_class',
        title:    `📡 حصة مباشرة: ${title}`,
        body:     `المدرس ${teacherUser?.name || ''} بدأ حصة مباشرة. انضم الآن!\nكود الانضمام: ${roomCode}`,
        roomCode,
        roomId:   room.id,
        roomName: room.roomName,
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
                roomId:   room.id,
                roomName: room.roomName,
                senderUserId: teacherUserId,
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
      title,
      description,
      enableChat:        enableChat        ?? true,
      enableScreenShare: enableScreenShare ?? true,
      recordSession:     recordSession     ?? false,
      waitingRoom:       waitingRoom       ?? false,
      scheduledTime:     scheduledTime     || null,
    };
  }

  // ── END ROOM + AUTO-SAVE AS LESSON ───────────────────────────────
  async endRoom(roomId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });

    const room = await prisma.webrtcRoom.findFirst({
      where: { id: roomId, hostId: teacher?.id },
      include: { course: { select: { id: true, title: true } } },
    });

    if (!room) {
      const err = new Error('Room not found or not yours');
      err.statusCode = 404;
      throw err;
    }

    const endedAt = new Date();
    const startedAt = room.startedAt || room.createdAt;
    const durationMinutes = Math.round((endedAt - startedAt) / 60000);

    const updated = await prisma.webrtcRoom.update({
      where: { id: roomId },
      data: { isActive: false, endedAt },
    });

    // ── Auto-save as lesson if linked to a course ───────────────────
    let savedLesson = null;
    if (room.courseId) {
      try {
        // Get next lesson order
        const lessonsCount = await prisma.lesson.count({
          where: { courseId: room.courseId },
        });

        const lessonTitle = `حصة مباشرة مسجلة — ${new Date(startedAt).toLocaleDateString('ar-EG', {
          day: 'numeric', month: 'long', year: 'numeric',
        })}`;

        savedLesson = await prisma.lesson.create({
          data: {
            courseId:   room.courseId,
            title:      lessonTitle,
            content:    `حصة مباشرة مدتها ${durationMinutes} دقيقة`,
            summary:    `حصة لايف انتهت في ${endedAt.toLocaleTimeString('ar-EG')}`,
            order:      lessonsCount + 1,
            isPublished: true,
            // videoUrl will be null unless recording was implemented
          },
        });
      } catch (lessonErr) {
        console.error('⚠️ Could not auto-save lesson:', lessonErr.message);
      }
    }

    // Notify participants
    try {
      const io = getIO();
      io.to(`room:${room.roomName}`).emit('live_class:ended', { roomId });
    } catch (_) {}

    return {
      ended: true,
      roomId,
      durationMinutes,
      savedLesson: savedLesson ? {
        id: savedLesson.id,
        title: savedLesson.title,
        courseId: room.courseId,
      } : null,
    };
  }

  async getTeacherRooms(teacherUserId, { page = 1, limit = 10 } = {}) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
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

  async getActiveRoom(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) return null;

    return prisma.webrtcRoom.findFirst({
      where: { hostId: teacher.id, isActive: true },
      include: {
        course: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });
  }

  async getTeacherCourses(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
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

  async getRoomStats(teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) return { total: 0, active: 0, totalParticipants: 0 };

    const [total, active, totalParticipants] = await Promise.all([
      prisma.webrtcRoom.count({ where: { hostId: teacher.id } }),
      prisma.webrtcRoom.count({ where: { hostId: teacher.id, isActive: true } }),
      prisma.webrtcParticipant.count({
        where: { room: { hostId: teacher.id } },
      }),
    ]);

    return { total, active, totalParticipants };
  }

  // ── GET course details for teacher (students + live rooms + lessons + exams) ──
  async getCourseDetails(courseId, teacherUserId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 403 });

    const course = await prisma.course.findFirst({
      where: { id: courseId, teacherId: teacher.id },
    });
    if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

    const [students, liveRooms, lessons, exams] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId },
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
        where: { courseId, isActive: false },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { participants: true } } },
      }),
      prisma.lesson.findMany({
        where: { courseId },
        orderBy: { order: 'asc' },
      }),
      prisma.exam.findMany({
        where: { courseId },
        include: {
          _count: { select: { attempts: true, questions: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      course,
      students: students.map(e => ({
        enrollmentId: e.id,
        enrolledAt: e.enrolledAt,
        progress: e.progress,
        student: {
          id: e.student.id,
          userId: e.student.userId,
          name: e.student.user.name,
          email: e.student.user.email,
          avatar: e.student.user.avatar,
        },
      })),
      liveRooms: liveRooms.map(r => ({
        id: r.id,
        roomName: r.roomName,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMinutes: r.startedAt && r.endedAt
          ? Math.round((new Date(r.endedAt) - new Date(r.startedAt)) / 60000)
          : null,
        participants: r._count.participants,
      })),
      lessons,
      exams: exams.map(e => ({
        id: e.id,
        title: e.title,
        isPublished: e.isPublished,
        totalMarks: e.totalMarks,
        passingMarks: e.passingMarks,
        createdAt: e.createdAt,
        questionsCount: e._count.questions,
        attemptsCount: e._count.attempts,
      })),
    };
  }
}

export default new LiveClassesService();