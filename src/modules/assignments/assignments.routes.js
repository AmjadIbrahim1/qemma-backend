// backend/src/modules/assignments/assignments.routes.js

import express                   from 'express';
import multer                    from 'multer';
import assignmentsController     from './assignments.controller.js';
import { authMiddleware, authorizeRoles } from '../auth/auth.middleware.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/'];
    const isAllowed = allowed.some(type => file.mimetype.startsWith(type));
    if (!isAllowed) return cb(new Error('Only PDF and image files are allowed'));
    cb(null, true);
  },
});

router.use(authMiddleware);

// ── Teacher routes ──────────────────────────────────────────────
router.get('/teacher/courses',                  authorizeRoles('teacher'),       (req, res) => assignmentsController.getTeacherCourses(req, res));
router.get('/teacher/courses/:courseId/lessons', authorizeRoles('teacher'),       (req, res) => assignmentsController.getCourseLessons(req, res));
router.post('/',                                authorizeRoles('teacher'),       (req, res) => assignmentsController.createAssignment(req, res));
router.get('/teacher',                          authorizeRoles('teacher'),       (req, res) => assignmentsController.getTeacherAssignments(req, res));
router.get('/teacher/:assignmentId',             authorizeRoles('teacher'),       (req, res) => assignmentsController.getAssignmentDetail(req, res));
router.patch('/submissions/:submissionId/grade', authorizeRoles('teacher'),       (req, res) => assignmentsController.gradeSubmission(req, res));

// ── Student routes ──────────────────────────────────────────────
router.get('/student',                          authorizeRoles('student'),       (req, res) => assignmentsController.getStudentAssignments(req, res));
router.post('/:assignmentId/submit',            authorizeRoles('student'), upload.single('file'), (req, res) => assignmentsController.submitAssignment(req, res));

export default router;
