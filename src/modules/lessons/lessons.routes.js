// backend/src/modules/lessons/lessons.routes.js
// CHANGES:
//   • Multer يقبل حقلين: video (500 MB) و pdf (50 MB)
//   • كل الـ routes محمية بـ authMiddleware

import express from 'express';
import multer  from 'multer';
import lessonsController from './lessons.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// ── Multer: in-memory, multi-field ───────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max per file
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/', 'application/pdf'];
    const isAllowed = allowed.some(type => file.mimetype.startsWith(type));
    if (!isAllowed) {
      return cb(new Error('Only video and PDF files are allowed'));
    }
    cb(null, true);
  },
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'pdf',   maxCount: 1 },
]);

// ── All routes require auth ──────────────────────────────────────────────
router.use(authMiddleware);

// CRUD
router.post('/',                  upload, (req, res) => lessonsController.createLesson(req, res));
router.get('/course/:courseId',          (req, res) => lessonsController.getCourseLessons(req, res));
router.get('/:id',                       (req, res) => lessonsController.getLesson(req, res));
router.put('/:id',                upload, (req, res) => lessonsController.updateLesson(req, res));
router.delete('/:id',                    (req, res) => lessonsController.deleteLesson(req, res));

export default router;