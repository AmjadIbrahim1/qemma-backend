// backend/src/app.js
// CHANGE: أُضيف assistantRoutes

import express       from 'express';
import cors          from 'cors';
import helmet        from 'helmet';
import morgan        from 'morgan';
import compression   from 'compression';
import cookieParser  from 'cookie-parser';
import rateLimit     from 'express-rate-limit';
import path          from 'path';
import { fileURLToPath } from 'url';
import 'express-async-errors';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

import authRoutes          from './modules/auth/auth.routes.js';
import coursesRoutes       from './modules/courses/courses.routes.js';
import lessonsRoutes       from './modules/lessons/lessons.routes.js';
import examsRoutes         from './modules/exams/exams.routes.js';
import attemptsRoutes      from './modules/exams/attempts/attempts.routes.js';
import liveClassesRoutes   from './modules/live-classes/live-classes.routes.js';
import scheduleRoutes      from './modules/schedule/schedule.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import booksRoutes         from './modules/books/books.routes.js';
import analyticsRoutes     from './modules/analytics/analytics.routes.js';
import webrtcRoutes        from './modules/webrtc/webrtc.routes.js';
import paymentRoutes       from './modules/payments/payment.routes.js';
import enrollmentsRoutes   from './modules/enrollments/enrollments.routes.js';
import assignmentsRoutes   from './modules/assignments/assignments.routes.js';
import studentsRoutes      from './modules/students/students.routes.js';
import chatRoutes          from './modules/chat/chat.routes.js';
import assistantRoutes     from './modules/assistant/assistant.routes.js'; // ✅ NEW
import parentsRoutes       from './modules/parents/parents.routes.js';   // ✅ PARENTS

import errorMiddleware from './shared/middlewares/error.middleware.js';

const app = express();

// ── Security & Parsing ─────────────────────────────────────────
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());

if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));
else app.use(morgan('combined'));

// ── Rate Limiting ──────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

app.use('/api/auth', authLimiter);
app.use('/api/',     generalLimiter);

// ── Static Files ───────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// ── Health ─────────────────────────────────────────────────────
app.get('/', (_, res) =>
  res.json({ success: true, message: 'Qemma Backend API is running! 🚀', version: '1.0.0' }));

app.get('/api/health', (_, res) =>
  res.json({ success: true, status: 'healthy', uptime: process.uptime(), timestamp: new Date() }));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/courses',       coursesRoutes);
app.use('/api/lessons',       lessonsRoutes);
app.use('/api/exams',         examsRoutes);
app.use('/api/attempts',      attemptsRoutes);
app.use('/api/live-classes',  liveClassesRoutes);
app.use('/api/schedule',      scheduleRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/books',         booksRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/webrtc',        webrtcRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/enrollments',   enrollmentsRoutes);
app.use('/api/assignments',   assignmentsRoutes);
app.use('/api/students',      studentsRoutes);
app.use('/api/chat',          chatRoutes);app.use('/api/assistant',     assistantRoutes);  // ✅ NEW
app.use('/api/parents',       parentsRoutes);    // ✅ PARENTS

  // ── 404 ────────────────────────────────────────────────────────
app.use('*', (req, res) =>
  res.status(404).json({ success: false, message: 'Route not found', path: req.originalUrl }));

// ── Error Handler ──────────────────────────────────────────────
app.use(errorMiddleware);

export default app;