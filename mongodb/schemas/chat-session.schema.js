// backend/mongodb/schemas/chat-session.schema.js
// Chat Session — a 3-way conversation between Student ↔ Main Teacher ↔ Assistant Teacher
// Each session is UNIQUE per (studentId + teacherUserId + courseId)
// This enforces full course-based chat separation.

import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema(
  {
    // The Prisma Student ID this session belongs to
    studentId: {
      type: String,
      required: true,
      index: true,
    },

    // The User ID of the main teacher (denormalised for fast lookup)
    teacherUserId: {
      type: String,
      required: true,
      index: true,
    },

    // The User ID of the linked assistant teacher (optional)
    assistantTeacherUserId: {
      type: String,
      default: null,
      index: true,
    },

    // Course this session is associated with — REQUIRED for course-based separation
    // Every chat room is unique per (studentId + teacherUserId + courseId)
    courseId: {
      type: String,
      default: null,
      index: true,
    },

    // Course title (denormalised for fast display without extra DB calls)
    courseTitle: {
      type: String,
      default: '',
    },

    // Session type (e.g. "teacher_support", "general")
    sessionType: {
      type: String,
      default: 'teacher_support',
      index: true,
    },

    // Timestamp of the last activity
    lastActive: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Whether the session is still active
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,          // createdAt, updatedAt
    collection: 'chat_sessions',
  }
);

// ── Unique compound index: one room per student × teacher × course ──────────
// This is the core constraint that enforces course-based chat separation.
chatSessionSchema.index(
  { studentId: 1, teacherUserId: 1, courseId: 1 },
  { unique: true, sparse: false }
);

// Index for fetching all sessions of a student
chatSessionSchema.index({ studentId: 1, lastActive: -1 });

// Index for fetching all sessions for a teacher (or assistant via teacherUserId)
chatSessionSchema.index({ teacherUserId: 1, lastActive: -1 });

// Index for sorting by lastActive
chatSessionSchema.index({ lastActive: -1 });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

export default ChatSession;