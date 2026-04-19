// backend/src/socket/socket.config.js
import { Server } from 'socket.io';
import { verifyToken } from '../shared/utils/jwt.util.js';
import assistantVerificationService from '../modules/auth/assistant-verification.service.js';

let io;

export const initSocket = (httpServer) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── Auth middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) return next(new Error('Authentication token required'));

      const payload = verifyToken(token);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, role } = socket.user;

    // Personal room for direct messages
    socket.join(`user:${userId}`);
    console.log(`🔌 Socket connected: userId=${userId}, role=${role}`);

    // ── Join a live room ─────────────────────────────────────────
    socket.on('live_class:join', ({ roomName }) => {
      socket.join(`room:${roomName}`);
      socket.data.roomName = roomName;
      console.log(`👤 userId=${userId} joined room:${roomName}`);
    });

    // ── Leave a live room ────────────────────────────────────────
    socket.on('live_class:leave', ({ roomName }) => {
      socket.leave(`room:${roomName}`);
    });

    // ── Chat message relay ───────────────────────────────────────
    socket.on('live_class:chat_message', (data) => {
      // Relay to everyone in the room except the sender
      socket.to(`room:${data.roomName}`).emit('live_class:chat_message', {
        senderName: data.senderName,
        message: data.message,
        senderId: userId,
      });
    });

    // ── Hand raised relay ────────────────────────────────────────
    socket.on('live_class:raise_hand', (data) => {
      socket.to(`room:${data.roomName}`).emit('live_class:hand_raised', {
        userId,
        name: data.name,
      });
    });

    // ────────────────────────────────────────────────────────────
    // WebRTC Signaling
    // ────────────────────────────────────────────────────────────

    // Teacher → Student: SDP offer
    socket.on('webrtc:offer', ({ roomName, targetUserId, offer }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:offer', {
        fromUserId: userId,
        roomName,
        offer,
      });
    });

    // Student → Teacher: SDP answer
    socket.on('webrtc:answer', ({ roomName, targetUserId, answer }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:answer', {
        fromUserId: userId,
        roomName,
        answer,
      });
    });

    // Both directions: ICE candidates
    socket.on('webrtc:ice-candidate', ({ roomName, targetUserId, candidate }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:ice-candidate', {
        fromUserId: userId,
        roomName,
        candidate,
      });
    });

    // ── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: userId=${userId}`);

      // Notify room if student/teacher was in a live class
      if (socket.data.roomName) {
        socket.to(`room:${socket.data.roomName}`).emit('live_class:student_left', {
          userId,
        });
      }
    });
  });

  assistantVerificationService.setIO(io);
  console.log('✅ Socket.IO initialised');

  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialised yet');
  return io;
};