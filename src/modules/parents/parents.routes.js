// backend/src/modules/parents/parents.routes.js

import express from 'express';
import parentsController from './parents.controller.js';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware.js';
import { requireActivatedParent } from '../auth/parent-activation.middleware.js';

const router = express.Router();

router.use(authMiddleware);
router.use(authorizeRoles('parent'));

// ✅ Block inactive parents from accessing ANY content routes
router.use(requireActivatedParent);

// ── Children routes ─────────────────────────────────────────────
router.get('/children',                                parentsController.getChildren);
router.get('/children/:childId/summary',               parentsController.getChildSummary);
router.get('/children/:childId/dashboard',             parentsController.getChildDashboard);
router.get('/children/:childId/performance',           parentsController.getChildPerformance);
router.get('/children/:childId/tasks',                 parentsController.getChildTasks);
router.get('/children/:childId/exam-results',          parentsController.getChildExamResults);
router.get('/children/:childId/courses',               parentsController.getChildCourses);
router.get('/children/:childId/courses/:courseId',     parentsController.getChildCourseDetails);
router.get('/children/:childId/books',                 parentsController.getChildBooks);
router.get('/children/:childId/notifications',         parentsController.getChildNotifications);

// ── Reports ─────────────────────────────────────────────────────
router.get('/reports/export',                            parentsController.exportReportsExcel);

// ── Add child (after OTP verification) ────────────────────────
router.post('/link-child',                               parentsController.linkChild);

export default router;
