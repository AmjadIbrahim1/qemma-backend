// backend/src/modules/exams/attempts/attempts.routes.js

import express from 'express';
import attemptsController from './attempts.controller.js';
import { authMiddleware } from '../../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// ── Student routes (must come BEFORE /:id routes) ────────────────
router.post('/exam/:examId/start',  attemptsController.startExam);           // POST /api/attempts/exam/:examId/start
router.post('/exam/:examId/submit', attemptsController.submitExam);          // POST /api/attempts/exam/:examId/submit
router.get('/exam/:examId/review',  attemptsController.getStudentReviewData); // GET  /api/attempts/exam/:examId/review

// ── Teacher routes ───────────────────────────────────────────────
router.get('/',           attemptsController.getTeacherAttempts); // GET /api/attempts
router.get('/stats',      attemptsController.getExamStats);       // GET /api/attempts/stats
router.get('/:id',        attemptsController.getAttemptById);     // GET /api/attempts/:id
router.patch('/:id/grade', attemptsController.gradeAttempt);      // PATCH /api/attempts/:id/grade
router.post('/:id/auto-grade', attemptsController.autoGrade);     // POST /api/attempts/:id/auto-grade

// ── Assistant teacher routes ────────────────────────────────────
router.post('/:id/assistant-grade', attemptsController.assistantGradeEssays); // POST /api/attempts/:id/assistant-grade

export default router;