// backend/src/modules/chat/chat.controller.js
// COURSE-BASED SEPARATION:
//   Every session is tied to a specific courseId.
//   Teacher/assistant can open a chat per student per course.

import chatService from './chat.service.js';

class ChatController {

  // ─────────────────────────────────────────────────────────────
  // Get or create a chat session (للطالب — يبدأ الشات داخل كورس)
  // POST /api/chat/sessions
  // Body: { teacherUserId, courseId, sessionType }
  // ─────────────────────────────────────────────────────────────
  async getOrCreateSession(req, res, next) {
    try {
      const { teacherUserId, courseId, sessionType } = req.body;

      if (!courseId) {
        return res.status(400).json({ success: false, message: 'courseId is required' });
      }

      const { default: prisma } = await import('../../config/prisma.config.js');
      const student = await prisma.student.findUnique({ where: { userId: req.user.userId } });
      if (!student) {
        return res.status(403).json({ success: false, message: 'هذا الحساب ليس حساب طالب' });
      }

      const result = await chatService.getOrCreateSession({
        studentId:   student.id,
        teacherUserId,
        courseId,
        sessionType: sessionType || 'teacher_support',
      });

      res.status(200).json({
        success: true,
        data: {
          id:          result.session.id,
          sessionType: result.session.sessionType,
          lastActive:  result.session.lastActive,
          courseId:    result.session.courseId,
          courseTitle: result.session.courseTitle || '',
          studentName: result.student?.user?.name || 'طالب',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Teacher/assistant opens chat with a student in a specific course
  // POST /api/chat/teacher/open-session
  // Body: { studentUserId, courseId }
  // ─────────────────────────────────────────────────────────────
  async openSessionWithStudent(req, res, next) {
    try {
      const { studentUserId, courseId } = req.body;
      if (!studentUserId) {
        return res.status(400).json({ success: false, message: 'studentUserId is required' });
      }
      if (!courseId) {
        return res.status(400).json({ success: false, message: 'courseId is required' });
      }

      const session = await chatService.getOrCreateSessionForStudent(
        req.user.userId,
        studentUserId,
        courseId,
      );

      res.status(200).json({ success: true, data: session });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Send a message
  // POST /api/chat/sessions/:sessionId/messages
  // Body: { message }
  // ─────────────────────────────────────────────────────────────
  async sendMessage(req, res, next) {
    try {
      const { sessionId } = req.params;
      const { message }   = req.body;

      const result = await chatService.sendMessage(sessionId, req.user.userId, message);

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Get messages for a session
  // GET /api/chat/sessions/:sessionId/messages
  // ─────────────────────────────────────────────────────────────
  async getMessages(req, res, next) {
    try {
      const { sessionId } = req.params;
      const messages = await chatService.getMessages(sessionId, req.user.userId);

      res.status(200).json({ success: true, data: messages });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Get all sessions for current user
  // GET /api/chat/sessions
  // ─────────────────────────────────────────────────────────────
  async getUserSessions(req, res, next) {
    try {
      const sessions = await chatService.getUserSessions(req.user.userId);

      res.status(200).json({ success: true, data: sessions });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER/ASSISTANT: Get all students
  // GET /api/chat/teacher/students
  // ─────────────────────────────────────────────────────────────
  async getTeacherStudents(req, res, next) {
    try {
      const students = await chatService.getTeacherChatStudents(req.user.userId);

      res.status(200).json({ success: true, data: students });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER/ASSISTANT: Get all courses (for dropdown)
  // GET /api/chat/teacher/courses
  // ─────────────────────────────────────────────────────────────
  async getTeacherCourses(req, res, next) {
    try {
      const courses = await chatService.getTeacherCourses(req.user.userId);

      res.status(200).json({ success: true, data: courses });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEACHER/ASSISTANT: Get students by course
  // GET /api/chat/teacher/courses/:courseId/students
  // ─────────────────────────────────────────────────────────────
  async getStudentsByCourse(req, res, next) {
    try {
      const { courseId } = req.params;
      const students = await chatService.getStudentsByCourse(req.user.userId, courseId);

      res.status(200).json({ success: true, data: students });
    } catch (error) {
      next(error);
    }
  }
}

export default new ChatController();