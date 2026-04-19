// backend/src/modules/exams/attempts/attempts.routes.js

import express from 'express';
import attemptsController from './attempts.controller.js';
import { authMiddleware } from '../../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// Teacher routes
router.get('/',           attemptsController.getTeacherAttempts); // GET /api/attempts
router.get('/stats',      attemptsController.getExamStats);       // GET /api/attempts/stats
router.get('/:id',        attemptsController.getAttemptById);     // GET /api/attempts/:id
router.patch('/:id/grade', attemptsController.gradeAttempt);      // PATCH /api/attempts/:id/grade
router.post('/:id/auto-grade', attemptsController.autoGrade);     // POST /api/attempts/:id/auto-grade

export default router;