// backend/src/config/clerk.config.js
import { createClerkClient } from '@clerk/clerk-sdk-node';

if (!process.env.CLERK_SECRET_KEY) {
  console.error('❌ CLERK_SECRET_KEY is not set. Clerk authentication will not work.');
  throw new Error('CLERK_SECRET_KEY environment variable is required');
}

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Test Clerk connection
(async () => {
  try {
    // Try to get a user count or make a simple API call
    await clerkClient.users.getUserList({ limit: 1 });
    console.log('✅ Clerk client initialized successfully');
  } catch (error) {
    console.error('❌ Clerk client initialization failed:', error.message);
  }
})();

export default clerkClient;