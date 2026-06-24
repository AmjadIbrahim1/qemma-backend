// backend/src/modules/chat/chat.routes.js

import express from 'express';
import chatController from './chat.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// ── Sessions (للطالب) ───────────────────────────────────────────
router.post('/sessions',    chatController.getOrCreateSession);  // POST /api/chat/sessions
router.get('/sessions',     chatController.getUserSessions);     // GET  /api/chat/sessions

// ── Messages ────────────────────────────────────────────────────
router.get( '/sessions/:sessionId/messages', chatController.getMessages);   // GET
router.post('/sessions/:sessionId/messages', chatController.sendMessage);   // POST

// ── Teacher/Assistant Chat Management ──────────────────────────
router.post('/teacher/open-session',                   chatController.openSessionWithStudent);   // POST — يفتح شات مع طالب
router.get( '/teacher/students',                       chatController.getTeacherStudents);       // GET  — كل الطلاب
router.get( '/teacher/courses',                        chatController.getTeacherCourses);        // GET  — كل الكورسات
router.get( '/teacher/courses/:courseId/students',     chatController.getStudentsByCourse);      // GET  — طلاب كورس معين

export default router;