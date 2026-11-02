// backend/mongodb/models/index.js
// Central export for all Mongoose models

import ChatSession from '../schemas/chat-session.schema.js';
import ChatMessage from '../schemas/chat-message.schema.js';

export {
  ChatSession,
  ChatMessage,
};

export default {
  ChatSession,
  ChatMessage,
};
