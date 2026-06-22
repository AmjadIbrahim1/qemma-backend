// backend/src/modules/contests/contests.routes.js
// ✅ NEW (contests feature): Contest routes. Mirrors exams.routes.js layering.
// Static routes BEFORE /:id routes (Express path precedence). Role gating via authorizeRoles.

import express from 'express';
import contestsController from './contests.controller.js';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware.js';

const router = express.Router();

router.use(authMiddleware);

// ── STATIC routes (MUST come before /:id — Express path precedence) ──
// Teacher: list upcoming contests the teacher can add questions to
router.get(  '/teacher',         authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.getTeacherContests(req, res, next));
// ✅ NEW: Teacher: list ended contests (history)
router.get(  '/teacher/history', authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.getTeacherPastContests(req, res, next));
// Student: list available contests (stream + 3rd-year + active window)
router.get(  '/available',       authorizeRoles('student'), (req, res, next) => contestsController.getAvailableContests(req, res, next));
// ✅ NEW: Student: list participated-and-ended contests (history)
router.get(  '/my-history',      authorizeRoles('student'), (req, res, next) => contestsController.getMyHistory(req, res, next));

// ── PARAMETERIZED routes (/:id) ────────────────────────────────
// Teacher: contest detail + question management
router.get(  '/:id',                                        authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.getContest(req, res, next));
router.get(  '/:id/questions',                              authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.getContestQuestions(req, res, next));
router.post( '/:id/questions',                              authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.addContestQuestion(req, res, next));
router.delete('/:id/questions/:questionId',                 authorizeRoles('teacher', 'assistant_teacher'), (req, res, next) => contestsController.deleteContestQuestion(req, res, next));
// Student: participation
router.post( '/:id/start',                                  authorizeRoles('student'), (req, res, next) => contestsController.startContest(req, res, next));
router.post( '/:id/submit',                                 authorizeRoles('student'), (req, res, next) => contestsController.submitContest(req, res, next));
router.get(  '/:id/participation',                          authorizeRoles('student'), (req, res, next) => contestsController.getMyParticipation(req, res, next));
// Per-question submit (note: :questionId is a sub-resource of :id)
router.post( '/:id/questions/:questionId/submit',           authorizeRoles('student'), (req, res, next) => contestsController.submitQuestionAnswer(req, res, next));

export default router;
