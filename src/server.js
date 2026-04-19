// backend/src/server.js
import 'dotenv/config';
import { createServer } from 'http';
import app from './app.js';
import { initSocket } from './socket/socket.config.js';

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const httpServer = createServer(app);

// Initialise Socket.IO (also injects io into AssistantVerificationService)
initSocket(httpServer);

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