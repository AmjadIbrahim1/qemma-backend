import express from 'express';
import examsController from './exams.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// ✅ المسارات الثابتة قبل /:id حتماً
router.post('/',               (req, res, next) => examsController.createExam(req, res, next));
router.get('/my',              (req, res, next) => examsController.getMyExams(req, res, next));
router.get('/student',         (req, res, next) => examsController.getStudentExams(req, res, next));

// ✅ المسارات بالـ id بعد كده
router.get('/:id/attempts',    (req, res, next) => examsController.getExamAttempts(req, res, next));
router.get('/:id',             (req, res, next) => examsController.getExam(req, res, next));
router.put('/:id',             (req, res, next) => examsController.updateExam(req, res, next));
router.delete('/:id',          (req, res, next) => examsController.deleteExam(req, res, next));
router.patch('/:id/publish',   (req, res, next) => examsController.togglePublish(req, res, next));

export default router;