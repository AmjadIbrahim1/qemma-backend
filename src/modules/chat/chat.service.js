// backend/src/modules/chat/chat.service.js
// 3-way chat: Student ↔ Main Teacher ↔ Assistant Teacher
// Chat sessions & messages stored in MongoDB (Mongoose)
// User/teacher/student references resolved via Prisma (PostgreSQL)
//
// COURSE-BASED SEPARATION:
//   Every chat session is UNIQUE per (studentId + teacherUserId + courseId).
//   A student enrolled in 3 courses has 3 separate chat rooms — one per course.
//   Sessions are NEVER merged across courses.

import prisma from '../../config/prisma.config.js';
import { getIO } from '../../socket/socket.config.js';
import { ChatSession, ChatMessage } from '../../../mongodb/models/index.js';

class ChatService {

  // ─────────────────────────────────────────────────────────────
  // INTERNAL: resolve effective teacher ID & assistant ID
  // للمدرس المساعد: the effectiveTeacherId = linkedTeacherId
  // للمدرس الأساسي: the effectiveTeacherId = teacher.id
  // ─────────────────────────────────────────────────────────────
  async _resolveTeacherIds(userId) {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      include: { user: { select: { id: true } } },
    });
    if (!teacher) return null;

    let mainTeacherId;
    let mainTeacherUserId;
    let assistantUserId;

    if (teacher.linkedTeacherId) {
      // This user is an assistant — fetch the main teacher
      mainTeacherId = teacher.linkedTeacherId;
      const mainTeacher = await prisma.teacher.findUnique({
        where: { id: mainTeacherId },
        include: { user: { select: { id: true } } },
      });
      mainTeacherUserId = mainTeacher?.userId || null;
      assistantUserId   = userId;
    } else {
      // This user is the main teacher
      mainTeacherId     = teacher.id;
      mainTeacherUserId = userId;

      // Find their linked assistant (if any)
      const assistant = await prisma.teacher.findFirst({
        where: { linkedTeacherId: teacher.id },
        include: { user: { select: { id: true } } },
      });
      assistantUserId = assistant?.user?.id || null;
    }

    return { teacher, mainTeacherId, mainTeacherUserId, assistantUserId };
  }

  // ─────────────────────────────────────────────────────────────
  // Get or create a chat session
  // Called by students when they open the chat tab inside a course.
  // courseId is REQUIRED to enforce per-course separation.
  // ─────────────────────────────────────────────────────────────
  async getOrCreateSession({ studentId, teacherUserId, courseId, sessionType = 'teacher_support' }) {
    if (!courseId) {
      const err = new Error('courseId is required for course-based chat separation');
      err.statusCode = 400;
      throw err;
    }

    // Resolve the main teacher and assistant for this teacher
    const teacherRecord = await prisma.teacher.findUnique({ where: { userId: teacherUserId } });
    if (!teacherRecord) {
      const err = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    let mainTeacherUserId = teacherUserId;
    let assistantTeacherUserId = null;

    if (teacherRecord.linkedTeacherId) {
      // teacherUserId is an assistant — resolve to the main teacher
      const mainTeacher = await prisma.teacher.findUnique({
        where: { id: teacherRecord.linkedTeacherId },
        include: { user: { select: { id: true } } },
      });
      mainTeacherUserId      = mainTeacher?.userId || teacherUserId;
      assistantTeacherUserId = teacherUserId;
    } else {
      // teacherUserId is the main teacher — find their assistant
      const assistant = await prisma.teacher.findFirst({
        where: { linkedTeacherId: teacherRecord.id },
        include: { user: { select: { id: true } } },
      });
      assistantTeacherUserId = assistant?.user?.id || null;
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      const err = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    // Fetch course title for denormalisation
    const course = await prisma.course.findUnique({
      where:  { id: courseId },
      select: { id: true, title: true },
    });
    const courseTitle = course?.title || '';

    // ── Upsert: one session per (student × teacher × course) ────
    let session = await ChatSession.findOne({
      studentId,
      teacherUserId: mainTeacherUserId,
      courseId,
      isActive: true,
    });

    if (session) {
      // Update assistant if it changed
      let changed = false;
      if (assistantTeacherUserId && session.assistantTeacherUserId !== assistantTeacherUserId) {
        session.assistantTeacherUserId = assistantTeacherUserId;
        changed = true;
      }
      if (!session.courseTitle && courseTitle) {
        session.courseTitle = courseTitle;
        changed = true;
      }
      if (changed) await session.save();
    } else {
      session = await ChatSession.create({
        studentId,
        teacherUserId:          mainTeacherUserId,
        assistantTeacherUserId,
        courseId,
        courseTitle,
        sessionType,
        lastActive:             new Date(),
        isActive:               true,
      });
    }

    const teacher = await prisma.teacher.findUnique({
      where:   { userId: mainTeacherUserId },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    const assistant = assistantTeacherUserId
      ? await prisma.teacher.findFirst({
          where:   { user: { id: assistantTeacherUserId } },
          include: { user: { select: { id: true, name: true, avatar: true } } },
        })
      : null;

    return { session, teacher, assistant, student };
  }

  // ─────────────────────────────────────────────────────────────
  // Send a message (broadcast to all 3 participants)
  // ─────────────────────────────────────────────────────────────
  async sendMessage(sessionId, senderUserId, messageText) {
    if (!messageText?.trim()) {
      const err = new Error('Message text is required');
      err.statusCode = 400;
      throw err;
    }

    if (!sessionId.match(/^[0-9a-fA-F]{24}$/)) {
      const err = new Error('Invalid session ID format');
      err.statusCode = 400;
      throw err;
    }

    const session = await ChatSession.findById(sessionId);
    if (!session) {
      const err = new Error('Chat session not found');
      err.statusCode = 404;
      throw err;
    }

    const sender = await prisma.user.findUnique({
      where:  { id: senderUserId },
      select: { id: true, name: true, avatar: true, role: true },
    });

    if (!sender) {
      const err = new Error('Sender not found');
      err.statusCode = 404;
      throw err;
    }

    const message = await ChatMessage.create({
      sessionId:    session._id,
      senderUserId,
      senderName:   sender.name   || '',
      senderAvatar: sender.avatar,
      senderRole:   sender.role   || 'student',
      message:      messageText.trim(),
      sentAt:       new Date(),
    });

    session.lastActive = new Date();
    await session.save();

    // ── Collect all 3 recipients ─────────────────────────────
    const recipientUserIds = new Set();

    // 1. Student
    const studentUser = await prisma.student.findUnique({
      where:  { id: session.studentId },
      select: { userId: true },
    });
    if (studentUser?.userId) recipientUserIds.add(studentUser.userId);

    // 2. Main teacher
    if (session.teacherUserId) recipientUserIds.add(session.teacherUserId);

    // 3. Assistant teacher
    if (session.assistantTeacherUserId) recipientUserIds.add(session.assistantTeacherUserId);

    const payload = {
      id:           message._id.toString(),
      sessionId:    session._id.toString(),
      courseId:     session.courseId,
      senderUserId: message.senderUserId,
      message:      message.message,
      sentAt:       message.sentAt,
      sender: {
        id:     sender.id,
        name:   sender.name,
        avatar: sender.avatar,
        role:   sender.role,
      },
    };

    // Broadcast via Socket.IO to each recipient individually (exclude sender)
    // NOTE: We do NOT emit to the session room because that would cause
    // duplicates — each recipient already receives the message via their
    // personal user room.
    try {
      const io = getIO();
      for (const userId of recipientUserIds) {
        if (userId !== senderUserId) {
          io.to(`user:${userId}`).emit('chat:message', payload);
        }
      }
    } catch (_) {
      // Socket not available — silent
    }

    return payload;
  }

  // ─────────────────────────────────────────────────────────────
  // Get messages for a session
  // ─────────────────────────────────────────────────────────────
  async getMessages(sessionId, userId) {
    if (!sessionId.match(/^[0-9a-fA-F]{24}$/)) {
      const err = new Error('Invalid session ID format');
      err.statusCode = 400;
      throw err;
    }

    const session = await ChatSession.findById(sessionId);
    if (!session) {
      const err = new Error('Chat session not found');
      err.statusCode = 404;
      throw err;
    }

    // Verify access
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, role: true },
    });

    const isStudentOwner = await prisma.student.findFirst({
      where: { id: session.studentId, userId },
    });

    const isTeacherOrAssistant =
      user?.role === 'teacher' || user?.role === 'assistant_teacher';

    const isSessionParticipant =
      session.teacherUserId === userId ||
      session.assistantTeacherUserId === userId;

    if (!isStudentOwner && !(isTeacherOrAssistant && isSessionParticipant)) {
      if (!isStudentOwner && !isSessionParticipant) {
        if (!isTeacherOrAssistant) {
          const err = new Error('Not authorized to view this chat');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    const messages = await ChatMessage.find({ sessionId: session._id })
      .sort({ sentAt: 1 })
      .lean();

    return messages.map((m) => ({
      id:           m._id.toString(),
      sessionId:    m.sessionId.toString(),
      courseId:     session.courseId,
      senderUserId: m.senderUserId,
      message:      m.message,
      sentAt:       m.sentAt,
      sender: {
        id:     m.senderUserId,
        name:   m.senderName,
        avatar: m.senderAvatar,
        role:   m.senderRole,
      },
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Get all chat sessions for a user
  // For students: returns their sessions (one per enrolled course)
  // For teachers/assistants: returns all student sessions grouped per course
  // ─────────────────────────────────────────────────────────────
  async getUserSessions(userId) {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'student') {
      return this._getStudentSessions(userId);
    } else if (user.role === 'teacher' || user.role === 'assistant_teacher') {
      return this._getTeacherSessions(userId);
    }

    return [];
  }

  // ── Student sessions: one per course they are enrolled in ────
  async _getStudentSessions(userId) {
    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) return [];

    const mongoSessions = await ChatSession.find({
      studentId: student.id,
      isActive:  true,
    }).sort({ lastActive: -1 }).lean();

    return this._enrichSessions(mongoSessions);
  }

  // ── Teacher / assistant sessions: all students × all courses ─
  async _getTeacherSessions(userId) {
    const ids = await this._resolveTeacherIds(userId);
    if (!ids) return [];

    // Fetch all courses owned by the main teacher
    const courses = await prisma.course.findMany({
      where:  { teacherId: ids.mainTeacherId },
      select: { id: true, title: true },
    });
    if (!courses.length) return [];

    const courseIds = courses.map((c) => c.id);

    // All enrolled students across those courses
    const enrollments = await prisma.enrollment.findMany({
      where:  { courseId: { in: courseIds } },
      select: { studentId: true, courseId: true },
    });

    if (!enrollments.length) return [];

    // Build unique (studentId, courseId) pairs
    const pairs = [...new Map(
      enrollments.map((e) => [`${e.studentId}::${e.courseId}`, e])
    ).values()];

    // Find existing sessions
    const studentIds = [...new Set(pairs.map((p) => p.studentId))];
    let mongoSessions = await ChatSession.find({
      studentId:     { $in: studentIds },
      teacherUserId: ids.mainTeacherUserId,
      isActive:      true,
    }).sort({ lastActive: -1 }).lean();

    // Create sessions for (student, course) pairs that don't have one yet
    const existingKeys = new Set(
      mongoSessions.map((s) => `${s.studentId}::${s.courseId}`)
    );

    const missing = pairs.filter((p) => !existingKeys.has(`${p.studentId}::${p.courseId}`));

    if (missing.length > 0) {
      const courseMap = Object.fromEntries(courses.map((c) => [c.id, c.title]));
      const newDocs = missing.map((p) => ({
        studentId:              p.studentId,
        teacherUserId:          ids.mainTeacherUserId,
        assistantTeacherUserId: ids.assistantUserId,
        courseId:               p.courseId,
        courseTitle:            courseMap[p.courseId] || '',
        sessionType:            'teacher_support',
        lastActive:             new Date(0),
        isActive:               true,
      }));

      // insertMany with ordered:false so duplicates don't abort the batch
      try {
        const created = await ChatSession.insertMany(newDocs, { ordered: false });
        const createdLean = created.map((d) => d.toObject());
        mongoSessions = [...mongoSessions, ...createdLean].sort(
          (a, b) => new Date(b.lastActive) - new Date(a.lastActive)
        );
      } catch (err) {
        // Duplicate key errors are expected for concurrent requests — ignore them
        if (err.code !== 11000) console.error('insertMany error:', err.message);
        // Re-fetch to get the actual state
        mongoSessions = await ChatSession.find({
          studentId:     { $in: studentIds },
          teacherUserId: ids.mainTeacherUserId,
          isActive:      true,
        }).sort({ lastActive: -1 }).lean();
      }
    }

    return this._enrichSessions(mongoSessions);
  }

  // ── Enrich sessions with last message + student info + count ─
  async _enrichSessions(mongoSessions) {
    if (!mongoSessions.length) return [];

    const sessionIds = mongoSessions.map((s) => s._id);

    // Last message per session
    const lastMessages = await ChatMessage.aggregate([
      { $match: { sessionId: { $in: sessionIds } } },
      { $sort:  { sentAt: -1 } },
      { $group: { _id: '$sessionId', message: { $first: '$$ROOT' } } },
    ]);
    const lastMsgMap = {};
    for (const lm of lastMessages) {
      lastMsgMap[lm._id.toString()] = lm.message;
    }

    // Message count per session
    const countAgg = await ChatMessage.aggregate([
      { $match: { sessionId: { $in: sessionIds } } },
      { $group: { _id: '$sessionId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const c of countAgg) {
      countMap[c._id.toString()] = c.count;
    }

    // Student info from Prisma
    const prismaStudentIds = [...new Set(mongoSessions.map((s) => s.studentId))];
    const prismaStudents   = await prisma.student.findMany({
      where:   { id: { in: prismaStudentIds } },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
    const studentMap = {};
    for (const s of prismaStudents) {
      studentMap[s.id] = s.user;
    }

    return mongoSessions.map((s) => {
      const sId     = s._id.toString();
      const lastMsg = lastMsgMap[sId];
      return {
        id:          sId,
        sessionType: s.sessionType,
        lastActive:  s.lastActive,
        courseId:    s.courseId,
        courseTitle: s.courseTitle || '',
        student:     studentMap[s.studentId] || null,
        lastMessage: lastMsg
          ? {
              id:      lastMsg._id.toString(),
              message: lastMsg.message,
              sentAt:  lastMsg.sentAt,
              sender:  { name: lastMsg.senderName, role: lastMsg.senderRole },
            }
          : null,
        messagesCount: countMap[sId] || 0,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Get all students for teacher chat management
  // Returns students grouped with their enrolled courses
  // ─────────────────────────────────────────────────────────────
  async getTeacherChatStudents(teacherUserId) {
    const ids = await this._resolveTeacherIds(teacherUserId);
    if (!ids) return [];

    const courses = await prisma.course.findMany({
      where:  { teacherId: ids.mainTeacherId },
      select: { id: true, title: true },
    });
    if (!courses.length) return [];

    const courseIds = courses.map((c) => c.id);
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      include: {
        course:  { select: { id: true, title: true } },
        student: {
          include: {
            user: { select: { id: true, name: true, avatar: true, email: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // Build a map: studentId → { ...studentInfo, courses: [...] }
    const studentMap = {};
    for (const e of enrollments) {
      const sid = e.student.id;
      if (!studentMap[sid]) {
        studentMap[sid] = {
          studentId: e.student.id,
          userId:    e.student.user.id,
          name:      e.student.user.name,
          avatar:    e.student.user.avatar,
          email:     e.student.user.email,
          courses:   [],
        };
      }
      studentMap[sid].courses.push({ id: e.course.id, title: e.course.title });
    }

    // Attach last message per student (from their most-recent session across all courses)
    for (const sid of Object.keys(studentMap)) {
      const session = await ChatSession.findOne({
        studentId: sid,
        isActive:  true,
      }).sort({ lastActive: -1 }).lean();

      if (session) {
        const lastMsg = await ChatMessage.findOne({ sessionId: session._id })
          .sort({ sentAt: -1 }).lean();
        if (lastMsg) {
          studentMap[sid].lastMessage = {
            id:      lastMsg._id.toString(),
            message: lastMsg.message,
            sender:  { name: lastMsg.senderName, role: lastMsg.senderRole },
          };
        }
      }
    }

    return Object.values(studentMap);
  }

  // ─────────────────────────────────────────────────────────────
  // Get all courses for a teacher (for the dropdown filter)
  // ─────────────────────────────────────────────────────────────
  async getTeacherCourses(teacherUserId) {
    const ids = await this._resolveTeacherIds(teacherUserId);
    if (!ids) return [];

    return prisma.course.findMany({
      where:   { teacherId: ids.mainTeacherId },
      select:  { id: true, title: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Get students by course for teacher
  // ─────────────────────────────────────────────────────────────
  async getStudentsByCourse(teacherUserId, courseId) {
    const ids = await this._resolveTeacherIds(teacherUserId);
    if (!ids) return [];

    const enrollments = await prisma.enrollment.findMany({
      where: {
        courseId,
        course: { teacherId: ids.mainTeacherId },
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, avatar: true, email: true } },
          },
        },
      },
    });

    return enrollments.map((e) => ({
      studentId: e.student.id,
      userId:    e.student.user.id,
      name:      e.student.user.name,
      avatar:    e.student.user.avatar,
      email:     e.student.user.email,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Teacher/assistant opens a chat with a specific student
  // in a specific course (courseId is required).
  // ─────────────────────────────────────────────────────────────
  async getOrCreateSessionForStudent(teacherUserId, studentUserId, courseId) {
    if (!courseId) {
      const err = new Error('courseId is required');
      err.statusCode = 400;
      throw err;
    }

    const ids = await this._resolveTeacherIds(teacherUserId);
    if (!ids) {
      const err = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    const student = await prisma.student.findUnique({ where: { userId: studentUserId } });
    if (!student) {
      const err = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    const course = await prisma.course.findUnique({
      where:  { id: courseId },
      select: { id: true, title: true },
    });
    const courseTitle = course?.title || '';

    // Upsert: one session per (student × teacher × course)
    let session = await ChatSession.findOne({
      studentId:     student.id,
      teacherUserId: ids.mainTeacherUserId,
      courseId,
      isActive:      true,
    });

    if (!session) {
      try {
        session = await ChatSession.create({
          studentId:              student.id,
          teacherUserId:          ids.mainTeacherUserId,
          assistantTeacherUserId: ids.assistantUserId,
          courseId,
          courseTitle,
          sessionType:            'teacher_support',
          lastActive:             new Date(),
          isActive:               true,
        });
      } catch (err) {
        if (err.code === 11000) {
          // Race condition: another request created it — fetch it
          session = await ChatSession.findOne({
            studentId:     student.id,
            teacherUserId: ids.mainTeacherUserId,
            courseId,
            isActive:      true,
          });
        } else {
          throw err;
        }
      }
    } else {
      // Update assistant if missing
      if (!session.assistantTeacherUserId && ids.assistantUserId) {
        session.assistantTeacherUserId = ids.assistantUserId;
        await session.save();
      }
    }

    return {
      id:          session._id.toString(),
      sessionType: session.sessionType,
      lastActive:  session.lastActive,
      courseId:    session.courseId,
      courseTitle: session.courseTitle || courseTitle,
      student:     { id: studentUserId },
    };
  }
}

export default new ChatService();