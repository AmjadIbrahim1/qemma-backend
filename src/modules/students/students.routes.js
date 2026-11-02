// backend/src/modules/students/students.routes.js

import express from 'express';
import studentsController from './students.controller.js';
import { authMiddleware, authorizeRoles, optionalAuth } from '../auth/auth.middleware.js';

const router = express.Router();

// ── Public GET rating endpoints (optional auth for personalized response) ──
router.get('/top-achievers', studentsController.getTopAchievers);
router.get('/rate/lesson/:lessonId',   optionalAuth, studentsController.getLessonRating);
router.get('/rate/teacher/:teacherId', optionalAuth, studentsController.getTeacherRating);
router.get('/rate/course/:courseId',   optionalAuth, studentsController.getCourseRating);
router.get('/rate/book/:bookId',       optionalAuth, studentsController.getBookRating);

// ── Protected routes ──
router.use(authMiddleware);

router.get('/dashboard',   studentsController.getDashboard);
router.get('/performance',           studentsController.getPerformance);
router.post('/performance/analyze',  studentsController.analyzePerformance);
router.get('/tasks',       studentsController.getTasks);

// ✅ NEW: Parent management routes — student activates linked parent
router.get('/parents',                          authorizeRoles('student'), studentsController.getLinkedParents);
router.post('/parents/:parentId/create-checkout-session', authorizeRoles('student'), studentsController.createParentActivationCheckoutSession);
router.post('/parents/:parentId/confirm-activation',     authorizeRoles('student'), studentsController.confirmParentActivation);

router.post('/rate/lesson/:lessonId',   authorizeRoles('student'), studentsController.rateLesson);
router.post('/rate/teacher/:teacherId', authorizeRoles('student'), studentsController.rateTeacher);
router.post('/rate/course/:courseId',   authorizeRoles('student'), studentsController.rateCourse);
router.post('/rate/book/:bookId',       authorizeRoles('student'), studentsController.rateBook);

export default router;
