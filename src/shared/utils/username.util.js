// backend/src/shared/utils/username.util.js
import crypto from 'crypto';
import prisma from '../../config/prisma.config.js';

const adjectives = [
  'Smart', 'Quick', 'Bright', 'Clever', 'Sharp', 'Wise', 'Bold', 'Brave',
  'Strong', 'Swift', 'Noble', 'Mighty', 'Stellar', 'Epic', 'Prime', 'Elite',
  'Super', 'Ultra', 'Mega', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Omega',
  'Phoenix', 'Dragon', 'Eagle', 'Falcon', 'Hawk', 'Thunder', 'Lightning',
  'Storm', 'Blaze', 'Frost', 'Shadow', 'Light', 'Dark', 'Cosmic', 'Quantum'
];

const nouns = [
  'Lion', 'Tiger', 'Fox', 'Wolf', 'Bear', 'Eagle', 'Hawk', 'Falcon',
  'Panther', 'Jaguar', 'Cheetah', 'Leopard', 'Puma', 'Lynx', 'Cobra',
  'Viper', 'Python', 'Dragon', 'Phoenix', 'Griffin', 'Sphinx', 'Titan',
  'Giant', 'Warrior', 'Champion', 'Hero', 'Knight', 'Samurai', 'Ninja',
  'Master', 'Legend', 'King', 'Queen', 'Prince', 'Star', 'Comet', 'Nova'
];

/**
 * Generates a username candidate string (not guaranteed unique yet)
 * @param {string} role
 * @returns {string}
 */
const buildCandidate = (role) => {
  let prefix = 'user_';
  if (role === 'student')           prefix = 'student_';
  else if (role === 'teacher')      prefix = 'teacher_';
  else if (role === 'assistant_teacher') prefix = 'asst_';

  const adj  = adjectives[crypto.randomInt(0, adjectives.length)];
  const noun = nouns[crypto.randomInt(0, nouns.length)];
  const num  = crypto.randomInt(0, 1000).toString().padStart(3, '0');

  return `${prefix}${adj}${noun}${num}`;
};

/**
 * Generates a unique username for the given role.
 * Retries up to `maxAttempts` times if a collision is found in DB.
 *
 * @param {string} role        - 'student' | 'teacher' | 'assistant_teacher'
 * @param {number} maxAttempts - how many times to retry on collision (default 10)
 * @returns {Promise<string>}  - a username guaranteed unique in the users table
 */
export const generateUniqueUsername = async (role, maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = buildCandidate(role);

    const existing = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;   // ✅ unique – use it
    }
  }

  // Extremely unlikely fallback: append a timestamp suffix
  const fallback = `${buildCandidate(role)}_${Date.now()}`;
  return fallback;
};

/**
 * Whether a role should receive a username at all.
 * Parents and admins do NOT get a username.
 *
 * @param {string} role
 * @returns {boolean}
 */
export const roleHasUsername = (role) =>
  ['student', 'teacher', 'assistant_teacher'].includes(role);