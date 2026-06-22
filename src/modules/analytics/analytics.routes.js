// backend/src/modules/analytics/analytics.routes.js

import express from 'express';
import analyticsController from './analytics.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/teacher/export',                  analyticsController.exportTeacherStats);
router.get('/teacher',                         analyticsController.getTeacherReport);
router.get('/teacher/students/:studentId',     analyticsController.getStudentPerformance);

export default router;