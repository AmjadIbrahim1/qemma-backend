import express from 'express';
import examGeneratorController from './exam-generator.controller.js';
import { authMiddleware, optionalAuth } from '../../auth/auth.middleware.js';

const router = express.Router();

router.post('/generate', authMiddleware, (req, res, next) => examGeneratorController.generate(req, res, next));
router.post('/submit/:examId', authMiddleware, (req, res, next) => examGeneratorController.submit(req, res, next));
router.get('/review/:examId', authMiddleware, (req, res, next) => examGeneratorController.review(req, res, next));
router.get('/my', authMiddleware, (req, res, next) => examGeneratorController.myExams(req, res, next));
router.get('/check-limit', authMiddleware, (req, res, next) => examGeneratorController.checkLimit(req, res, next));

export default router;
