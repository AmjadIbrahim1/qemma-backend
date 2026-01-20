import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, () => {
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
║                                           ║
╚═══════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});