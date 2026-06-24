// backend/mongodb/schemas/chat-message.schema.js
// Individual message within a 3-way chat session

import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    // Reference to the ChatSession
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatSession',
      required: true,
      index: true,
    },

    // Sender's User ID (from Prisma User model)
    senderUserId: {
      type: String,
      required: true,
      index: true,
    },

    // Denormalised sender info for fast reads (no joins needed)
    senderName: {
      type: String,
      default: '',
    },
    senderAvatar: {
      type: String,
      default: null,
    },
    senderRole: {
      type: String,
      default: 'student',
    },

    // Message content
    message: {
      type: String,
      default: '',
      maxlength: 10000,
    },

    // When the message was sent
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    // No automatic timestamps — use sentAt instead
    timestamps: false,
    collection: 'chat_messages',
  }
);

// Compound index for fetching messages of a session ordered by sentAt
chatMessageSchema.index({ sessionId: 1, sentAt: 1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

export default ChatMessage;
