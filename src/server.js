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
// ✅ NEW (test contest): auto-scheduled golden competition for testing — creates a 2-min
// contest every 10 minutes when no other test contest is upcoming or active.
import './jobs/testContestGenerator.job.js';
// ✅ NEW (hybrid cron strategy): startup catch-up coordinator — recovers any contest
// events missed during downtime (generator/reminder/scoring). Runs once on boot.
import { runStartupCatchUps } from './jobs/startup.js';
// ✅ Import test contest creator directly so we can await it before the HTTP server starts
import { ensureTestContest } from './jobs/testContestGenerator.job.js';

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

// ✅ Create the test contest immediately (awaited) so it's guaranteed to exist before
// the HTTP server starts accepting connections. Idempotent — skips if one already exists.
try { await ensureTestContest(); } catch (err) { console.error('❌ test contest creation on boot:', err.message); }

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