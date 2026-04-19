// backend/src/app.js
// FIX: Separate rate limiters so /api/auth/me doesn't get 429'd
//      on page load. Auth endpoints get 200 req/15min, everything
//      else gets 100 req/15min.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import 'express-async-errors';

import authRoutes          from './modules/auth/auth.routes.js';
import notificationsRouter from './modules/notifications/notifications.routes.js';
import coursesRoutes       from './modules/courses/courses.routes.js';
import lessonsRoutes       from './modules/lessons/lessons.routes.js';
import examsRoutes         from './modules/exams/exams.routes.js';
import errorMiddleware     from './shared/middlewares/error.middleware.js';
import attemptsRoutes      from './modules/exams/attempts/attempts.routes.js';
import analyticsRoutes     from './modules/analytics/analytics.routes.js';
import liveClassesRoutes   from './modules/live-classes/live-classes.routes.js';
import booksRoutes         from './modules/books/books.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── FIX: increase JSON limit to 10MB to accommodate base64 images ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());

if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));
else app.use(morgan('combined'));

// ── FIX: Separate rate limiters ───────────────────────────────────────────
// Auth endpoints (login, me, register) need a higher limit because the
// frontend can call /auth/me on every hot-reload or component mount.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                  // allow 300 requests per window for auth
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// All other API endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Apply auth limiter specifically to auth routes FIRST (before general)
app.use('/api/auth', authLimiter);

// Apply general limiter to all other API routes
app.use('/api/', generalLimiter);

app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// ── Routes ────────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.json({ success: true, message: 'Qemma Backend API is running! 🚀', version: '1.0.0' }));

app.get('/health', (req, res) =>
  res.json({ success: true, status: 'healthy', uptime: process.uptime() }));

app.use('/api/auth',          authRoutes);
app.use('/api/notifications', notificationsRouter);
app.use('/api/courses',       coursesRoutes);
app.use('/api/lessons',       lessonsRoutes);
app.use('/api/exams',         examsRoutes);
app.use('/api/attempts',      attemptsRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/live-classes',  liveClassesRoutes);
app.use('/api/books',         booksRoutes);

app.use('*', (req, res) =>
  res.status(404).json({ success: false, message: 'Route not found', path: req.originalUrl }));

app.use(errorMiddleware);

export default app;