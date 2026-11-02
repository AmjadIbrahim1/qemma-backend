// backend/src/modules/enrollments/enrollments.routes.js

import express from 'express';
import enrollmentsController from './enrollments.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// جلب كل كورسات الطالب
router.get('/my', enrollmentsController.getMyEnrollments.bind(enrollmentsController));

// تفاصيل كورس كاملة (درس + امتحانات + جلسات + مدرس)
router.get('/my/:courseId', enrollmentsController.getCourseDetail.bind(enrollmentsController));

// تحديث التقدم
router.patch('/my/:courseId/progress', enrollmentsController.updateProgress.bind(enrollmentsController));

export default router;