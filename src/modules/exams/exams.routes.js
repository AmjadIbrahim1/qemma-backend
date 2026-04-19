// backend/src/modules/exams/exams.routes.js

import express from 'express';
import examsController from './exams.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/',                    (req, res) => examsController.createExam(req, res));
router.get('/my',                   (req, res) => examsController.getMyExams(req, res));

// ✅ NEW: must be BEFORE /:id to avoid conflict
router.get('/:id/attempts',         (req, res) => examsController.getExamAttempts(req, res));

router.get('/:id',                  (req, res) => examsController.getExam(req, res));
router.put('/:id',                  (req, res) => examsController.updateExam(req, res));
router.delete('/:id',               (req, res) => examsController.deleteExam(req, res));
router.patch('/:id/publish',        (req, res) => examsController.togglePublish(req, res));

export default router;