// backend/src/modules/students/students.routes.js

import express from 'express';
import studentsController from './students.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/dashboard',   studentsController.getDashboard);
router.get('/performance', studentsController.getPerformance);
router.get('/tasks',       studentsController.getTasks);

export default router;
