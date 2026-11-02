// backend/src/modules/books/books.routes.js

import express from 'express';
import multer  from 'multer';
import booksController from './books.controller.js';
import { authMiddleware, optionalAuth, authorizeRoles } from '../auth/auth.middleware.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are allowed'));
    cb(null, true);
  },
});

// ── Public routes (NO auth) ─────────────────────────────────────
router.get('/', (req, res) => booksController.getPublishedBooks(req, res));

// ── Protected routes (auth applied per-route) ───────────────────
// Static routes MUST come before the dynamic /:id below
router.get('/my',            authMiddleware, (req, res) => booksController.getTeacherBooks(req, res));
router.get('/my/stats',      authMiddleware, (req, res) => booksController.getTeacherBookStats(req, res));
router.get('/purchased',     authMiddleware, (req, res) => booksController.getStudentBooks(req, res));

router.post('/',             authMiddleware, upload.single('pdfFile'), (req, res) => booksController.createBook(req, res));
router.put('/:id',           authMiddleware, upload.single('pdfFile'), (req, res) => booksController.updateBook(req, res));
router.delete('/:id',        authMiddleware, (req, res) => booksController.deleteBook(req, res));
router.patch('/:id/publish', authMiddleware, (req, res) => booksController.togglePublish(req, res));
router.post('/:id/purchase', authMiddleware, (req, res) => booksController.purchaseBook(req, res));

// ── Single-book GET with optional auth (hasPurchased included for logged-in students) ──
router.get('/:id', optionalAuth, (req, res) => booksController.getBook(req, res));

// ── Purchase status (fallback for logged-in students) ──
router.get('/:id/purchase-status', authMiddleware, authorizeRoles('student'), (req, res) => booksController.checkPurchaseStatus(req, res));

export default router;
