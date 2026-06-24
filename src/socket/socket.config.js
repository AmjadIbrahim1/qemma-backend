// backend/src/socket/socket.config.js

import { Server } from 'socket.io';
import { verifyToken } from '../shared/utils/jwt.util.js';
import assistantVerificationService from '../modules/auth/assistant-verification.service.js';
import { registerChatHandlers } from './chat.socket.js';

let io;

export const initSocket = (httpServer) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  io = new Server(httpServer, {
    cors: {
      origin:      allowedOrigins,
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

      const payload  = verifyToken(token);
      socket.user    = payload;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, role } = socket.user;

    // Personal room — used for direct notifications (e.g. OTP delivery)
    socket.join(`user:${userId}`);
    console.log(`🔌 Socket connected: userId=${userId}, role=${role}`);

    // ── Join a live room ─────────────────────────────────────────
    socket.on('live_class:join', ({ roomName }) => {
      socket.join(`room:${roomName}`);
      socket.data.roomName = roomName;
      console.log(`👤 userId=${userId} joined room:${roomName}`);

      // Broadcast to the room that a new participant joined
      socket.to(`room:${roomName}`).emit('live_class:student_joined', {
        userId,
        name: socket.user?.name || 'طالب',
      });
    });

    // ── Leave a live room ────────────────────────────────────────
    socket.on('live_class:leave', ({ roomName }) => {
      socket.leave(`room:${roomName}`);
    });

    // ── Chat message relay ───────────────────────────────────────
    socket.on('live_class:chat_message', (data) => {
      socket.to(`room:${data.roomName}`).emit('live_class:chat_message', {
        senderName: data.senderName,
        message:    data.message,
        senderId:   userId,
      });
    });

    // ── Hand raised relay ────────────────────────────────────────
    socket.on('live_class:raise_hand', (data) => {
      socket.to(`room:${data.roomName}`).emit('live_class:hand_raised', {
        userId,
        name: data.name,
      });
    });

    // ── Screen share relay ────────────────────────────────────────
    socket.on('live_class:screen_share_started', ({ roomName }) => {
      socket.to(`room:${roomName}`).emit('live_class:screen_share_started');
    });

    socket.on('live_class:screen_share_stopped', ({ roomName }) => {
      socket.to(`room:${roomName}`).emit('live_class:screen_share_stopped');
    });

    // ── Mute / Unmute individual student ───────────────────────────
    socket.on('live_class:mute_student', ({ roomName, targetUserId }) => {
      io.to(`user:${targetUserId}`).emit('live_class:muted', { by: userId });
    });

    socket.on('live_class:unmute_student', ({ roomName, targetUserId }) => {
      io.to(`user:${targetUserId}`).emit('live_class:unmuted', { by: userId });
    });

    // ── Mute / Unmute all students in the room ────────────────────
    socket.on('live_class:mute_all', ({ roomName }) => {
      socket.to(`room:${roomName}`).emit('live_class:muted', { by: userId });
    });

    socket.on('live_class:unmute_all', ({ roomName }) => {
      socket.to(`room:${roomName}`).emit('live_class:unmuted', { by: userId });
    });

    // ────────────────────────────────────────────────────────────
    // WebRTC Signaling
    // ────────────────────────────────────────────────────────────

    socket.on('webrtc:offer', ({ roomName, targetUserId, offer }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:offer', {
        fromUserId: userId,
        roomName,
        offer,
      });
    });

    socket.on('webrtc:answer', ({ roomName, targetUserId, answer }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:answer', {
        fromUserId: userId,
        roomName,
        answer,
      });
    });

    socket.on('webrtc:ice-candidate', ({ roomName, targetUserId, candidate }) => {
      io.to(`user:${targetUserId}`).emit('webrtc:ice-candidate', {
        fromUserId: userId,
        roomName,
        candidate,
      });
    });

    // ── Chat handlers ────────────────────────────────────────────
    registerChatHandlers(io, socket);

    // ── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: userId=${userId}`);

      if (socket.data.roomName) {
        socket.to(`room:${socket.data.roomName}`).emit('live_class:student_left', {
          userId,
        });
      }
    });
  });

  // ✅ Inject IO into verification service so it can emit OTP notifications
  assistantVerificationService.setIO(io);
  console.log('✅ Socket.IO initialised and injected into verification service');

  return io;
};

export const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialised yet');
  return io;
};