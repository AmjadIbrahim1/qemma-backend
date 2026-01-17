// backend/src/server.js
import http from 'http';
import dotenv from 'dotenv';
import app from './app.js';
import { initWebRTC } from './modules/webrtc/webrtc.socket.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Socket.IO
initWebRTC(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
