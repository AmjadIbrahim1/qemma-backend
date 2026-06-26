// backend/src/modules/webrtc/webrtc.socket.js
import { Server } from 'socket.io';

let io;

export const initWebRTC = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('join-room', (roomId) => {
      socket.join(roomId);
      socket.to(roomId).emit('user-joined', socket.id);
    });
  });
};

export { io };
