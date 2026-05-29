// backend/src/modules/books/books.routes.js

import express from 'express';
import booksController from './books.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// ── Public routes (NO auth) ─────────────────────────────────────
router.get('/', (req, res) => booksController.getPublishedBooks(req, res));

// ── Protected routes (auth applied per-route) ───────────────────
// Static routes MUST come before the dynamic /:id below
router.get('/my',            authMiddleware, (req, res) => booksController.getTeacherBooks(req, res));
router.get('/my/stats',      authMiddleware, (req, res) => booksController.getTeacherBookStats(req, res));
router.get('/purchased',     authMiddleware, (req, res) => booksController.getStudentBooks(req, res));

router.post('/',             authMiddleware, (req, res) => booksController.createBook(req, res));
router.put('/:id',           authMiddleware, (req, res) => booksController.updateBook(req, res));
router.delete('/:id',        authMiddleware, (req, res) => booksController.deleteBook(req, res));
router.patch('/:id/publish', authMiddleware, (req, res) => booksController.togglePublish(req, res));
router.post('/:id/purchase', authMiddleware, (req, res) => booksController.purchaseBook(req, res));

// ── Public single-book GET (must be last — after static paths) ──
router.get('/:id', (req, res) => booksController.getBook(req, res));

export default router;
