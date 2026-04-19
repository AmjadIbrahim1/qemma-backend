// backend/src/modules/books/books.routes.js

import express from 'express';
import booksController from './books.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();

// ── Public routes (NO auth) ─────────────────────────────────────
router.get('/', (req, res) => booksController.getPublishedBooks(req, res));

// ── Protected routes (auth required) ────────────────────────────
router.use(authMiddleware);

// ✅ Static routes FIRST — must come before /:id
router.get('/my',            (req, res) => booksController.getTeacherBooks(req, res));
router.get('/my/stats',      (req, res) => booksController.getTeacherBookStats(req, res));
router.get('/purchased',     (req, res) => booksController.getStudentBooks(req, res));

router.post('/',             (req, res) => booksController.createBook(req, res));
router.put('/:id',           (req, res) => booksController.updateBook(req, res));
router.delete('/:id',        (req, res) => booksController.deleteBook(req, res));
router.patch('/:id/publish', (req, res) => booksController.togglePublish(req, res));
router.post('/:id/purchase', (req, res) => booksController.purchaseBook(req, res));

// ✅ Dynamic route LAST — so it never shadows static routes above
router.get('/:id', (req, res) => booksController.getBook(req, res));

export default router;