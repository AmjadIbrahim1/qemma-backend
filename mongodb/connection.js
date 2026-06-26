// backend/mongodb/connection.js
// Mongoose connection to MongoDB

import mongoose from 'mongoose';

// Safely import logger — fall back to console if config is not initialised yet
let logger;
try {
  const mod = await import('../src/config/logger.config.js');
  logger = mod.default || console;
} catch {
  logger = console;
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/qemma';

export const connectMongoose = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info(`✅ Mongoose connected to MongoDB at ${MONGODB_URI.replace(/\/\/.*@/, '//***@')}`);
  } catch (error) {
    logger.error('❌ Mongoose connection error:', error.message);
    // Don't crash the process — allow fallback to Prisma-only mode
  }
};

mongoose.connection.on('error', (err) => {
  logger.error('❌ MongoDB runtime error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected');
});

export const isMongooseConnected = () => mongoose.connection.readyState === 1;

export default mongoose;
