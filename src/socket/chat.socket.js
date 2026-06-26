// backend/src/socket/chat.socket.js
// Chat-specific Socket.IO event handlers
// These are loaded by socket.config.js after init

export const registerChatHandlers = (io, socket) => {
  const { userId } = socket.user;

  // ── Join personal room (already done in socket.config, but keep for clarity) ──
  socket.on('chat:join_session', ({ sessionId }) => {
    socket.join(`chat:${sessionId}`);
    console.log(`📩 User ${userId} joined chat session ${sessionId}`);
  });

  // ── Leave a chat session room ──────────────────────────────────
  socket.on('chat:leave_session', ({ sessionId }) => {
    socket.leave(`chat:${sessionId}`);
  });

  // ── User is typing indicator ───────────────────────────────────
  socket.on('chat:typing', ({ sessionId, userName }) => {
    socket.to(`chat:${sessionId}`).emit('chat:typing', {
      userId,
      userName,
      sessionId,
    });
  });

  // ── User stopped typing ────────────────────────────────────────
  socket.on('chat:stop_typing', ({ sessionId }) => {
    socket.to(`chat:${sessionId}`).emit('chat:stop_typing', {
      userId,
      sessionId,
    });
  });
};
