// backend/src/server.js
import 'dotenv/config';
import { createServer } from 'http';
import app from './app.js';
import { initSocket } from './socket/socket.config.js';
import { connectMongoose } from '../mongodb/connection.js';
import './jobs/contestGenerator.job.js';
import './jobs/contestReminder.job.js';
import './jobs/contestScoring.job.js';
// ✅ NEW (AI question generation): 4th contest cron — fills missing questions via Groq
// within the 60-minute pre-start window.
import './jobs/contestQuestionGenerator.job.js';
// ✅ NEW (hybrid cron strategy): startup catch-up coordinator — recovers any contest
// events missed during downtime (generator/reminder/scoring). Runs once on boot.
import { runStartupCatchUps } from './jobs/startup.js';

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const httpServer = createServer(app);

// Initialise Socket.IO (also injects io into AssistantVerificationService)
initSocket(httpServer);

// Connect to MongoDB (non-blocking — graceful fallback if unavailable)
connectMongoose();

// ✅ NEW: run startup catch-up scans for the contest jobs after DB connections are set up.
// Fire-and-forget (async) so it doesn't block the HTTP listen; each catch-up is internally
// try/caught and idempotent, so a failure or overlap with a cron tick is safe.
runStartupCatchUps();

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║                                           ║
║   🎓 Qemma Backend Server Started!       ║
║                                           ║
║   Port:        ${PORT}                   ║
║   Environment: ${NODE_ENV}               ║
║   Time:        ${new Date().toLocaleString('en-US')} ║
║                                           ║
║   Health:      http://localhost:${PORT}/health   ║
║   API Docs:    http://localhost:${PORT}/api      ║
║   WebSocket:   ws://localhost:${PORT}            ║
║                                           ║
╚═══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  httpServer.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});