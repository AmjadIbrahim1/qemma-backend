// backend/src/shared/utils/username.util.js
// Generates unique, readable usernames for every role.
// Format:  <prefix>_<Adjective><Noun><2-3 digits>
// Examples:
//   student         → std_BraveWolf42
//   teacher         → tch_SwiftEagle7
//   assistant_teacher → ast_CleverFox19
//   parent          → par_WiseOwl88

import prisma from '../../config/prisma.config.js';

// ─────────────────────────────────────────────────────────────
// Word banks
// ─────────────────────────────────────────────────────────────
const ADJECTIVES = [
  'Brave', 'Swift', 'Clever', 'Bright', 'Bold',
  'Calm', 'Cool', 'Daring', 'Eager', 'Fair',
  'Fierce', 'Gentle', 'Happy', 'Kind', 'Lively',
  'Loyal', 'Mighty', 'Noble', 'Quick', 'Sharp',
  'Smart', 'Strong', 'True', 'Vivid', 'Wise',
  'Zesty', 'Agile', 'Cheerful', 'Diligent', 'Energetic',
];

const NOUNS = [
  'Wolf', 'Eagle', 'Fox', 'Bear', 'Lion',
  'Tiger', 'Hawk', 'Owl', 'Deer', 'Falcon',
  'Panther', 'Raven', 'Cobra', 'Lynx', 'Panda',
  'Jaguar', 'Condor', 'Bison', 'Crane', 'Heron',
  'Otter', 'Badger', 'Ferret', 'Viper', 'Drake',
  'Phoenix', 'Kraken', 'Griffin', 'Sphinx', 'Titan',
];

// ─────────────────────────────────────────────────────────────
// Role prefix map
// ─────────────────────────────────────────────────────────────
const ROLE_PREFIX = {
  student:           'std',
  teacher:           'tch',
  assistant_teacher: 'ast',
  parent:            'par',
};

/**
 * Returns true for every role that should receive a username.
 * All 4 roles supported by the platform get one.
 */
export const roleHasUsername = (role) => {
  return Object.keys(ROLE_PREFIX).includes(role);
};

/**
 * Generates a candidate username string (not yet checked for uniqueness).
 */
const buildCandidate = (role) => {
  const prefix = ROLE_PREFIX[role] || 'usr';
  const adj    = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun   = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const digits = Math.floor(Math.random() * 900 + 10); // 10-909  (2-3 digits)
  return `${prefix}_${adj}${noun}${digits}`;
};

/**
 * Generates a username that is guaranteed unique in the DB.
 * Tries up to `maxAttempts` times before throwing.
 *
 * @param {string} role - One of student | teacher | assistant_teacher | parent
 * @param {number} maxAttempts
 * @returns {Promise<string>} Unique username
 */
export const generateUniqueUsername = async (role, maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = buildCandidate(role);

    const existing = await prisma.user.findUnique({
      where:  { username: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  // Fallback: append timestamp to guarantee uniqueness
  const fallback = `${buildCandidate(role)}_${Date.now().toString(36)}`;
  return fallback;
};