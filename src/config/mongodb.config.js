// backend/src/config/mongodb.config.js
// MongoDB configuration

const mongodbConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/qemma',
  options: {
    // Mongoose 8.x defaults are sufficient
  },
};

export default mongodbConfig;
