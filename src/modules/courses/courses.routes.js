// backend/src/modules/courses/courses.routes.js

import express from 'express';
import multer from 'multer';
import coursesController from './courses.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// Multer — in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// ── PUBLIC routes (no auth required) ──────────────────────────────────────
router.get('/public',                         (req, res) => coursesController.getPublishedCourses(req, res));
router.get('/teacher/:teacherId',             (req, res) => coursesController.getTeacherProfile(req, res));
router.get('/teacher-by-user/:userId',        (req, res) => coursesController.getTeacherProfileByUserId(req, res));
router.get('/public/:id',                     (req, res) => coursesController.getCourse(req, res));

// ── PROTECTED routes (auth required) ──────────────────────────────────────
router.get('/my',             authMiddleware,  (req, res) => coursesController.getMyCourses(req, res));
router.get('/:id',            authMiddleware,  (req, res) => coursesController.getCourse(req, res));
router.post('/',              authMiddleware, upload.single('thumbnail'), (req, res) => coursesController.createCourse(req, res));
router.put('/:id',            authMiddleware, upload.single('thumbnail'), (req, res) => coursesController.updateCourse(req, res));
router.delete('/:id',         authMiddleware,  (req, res) => coursesController.deleteCourse(req, res));
router.patch('/:id/publish',  authMiddleware,  (req, res) => coursesController.togglePublish(req, res));

export default router;