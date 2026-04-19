// backend/src/modules/auth/auth.service.js
// CHANGES vs previous:
//   • registerLocal now fetches the full user (with student/teacher/parent)
//     after creating the role record, so Teacher.specialties is included
//     in the returned user object.
//   • loginLocal does the same — always returns the full user with relations.
//   • Everything else is identical to the version you provided.

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma.config.js';
import clerkClient from '../../config/clerk.config.js';
import { generateToken } from '../../shared/utils/jwt.util.js';
import { generateUniqueUsername, roleHasUsername } from '../../shared/utils/username.util.js';

class AuthService {
  // ─────────────────────────────────────────────────────────────
  // 🔵 LOCAL REGISTRATION
  // ─────────────────────────────────────────────────────────────
  async registerLocal(data) {
    const {
      email, password, name, role = 'student',
      phone, division, subject, teacherName,
      // NOTE: any client-supplied `username` is intentionally ignored
    } = data;

    console.log('📝 Registration request:', { email, role, division, subject });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ Generate unique username on the backend
    let username = null;
    if (roleHasUsername(role)) {
      username = await generateUniqueUsername(role);
      console.log('🎯 Generated username:', username);
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        phone,
        username,
        authProvider: 'local',
      },
    });

    console.log('✅ User created:', user.id, '| Role:', user.role, '| Username:', user.username);

    // ✅ Pass subject so it gets stored in Teacher.specialties
    await this.createRoleRecord(user.id, role, division, subject);

    // ✅ FIX: re-fetch with relations so Teacher.specialties is included
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { student: true, teacher: true, parent: true },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authProvider: 'local',
    });

    return { token, user: this.sanitizeUser(fullUser) };
  }

  // ─────────────────────────────────────────────────────────────
  // 🔵 LOCAL LOGIN
  // ─────────────────────────────────────────────────────────────
  async loginLocal(email, password) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    if (!user.passwordHash) {
      const error = new Error('Please login with Google. No password set for this account.');
      error.statusCode = 400;
      throw error;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // ✅ FIX: fetch with relations so Teacher.specialties is included
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { student: true, teacher: true, parent: true },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authProvider: user.authProvider,
    });

    return { token, user: this.sanitizeUser(fullUser) };
  }

  // ─────────────────────────────────────────────────────────────
  // 🟢 CLERK LOGIN / REGISTER
  // ─────────────────────────────────────────────────────────────
  async loginClerk(clerkUserId, role = 'student', division = null, subject = null, teacherName = null) {
    try {
      console.log('🔍 Clerk Login Request:', { clerkUserId, role, division, subject, teacherName });

      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      if (!clerkUser) {
        const error = new Error('Clerk user not found');
        error.statusCode = 404;
        throw error;
      }

      const email = clerkUser.emailAddresses[0]?.emailAddress;
      console.log('✅ Clerk user found:', { id: clerkUser.id, email });

      if (!email) {
        const error = new Error('No email found in Clerk account');
        error.statusCode = 400;
        throw error;
      }

      // ── Try to find existing user ──────────────────────────
      let user = await prisma.user.findFirst({ where: { clerkUserId } });
      if (!user) {
        user = await prisma.user.findUnique({ where: { email } });
      }

      if (user) {
        console.log('👤 Existing user found:', user.id);

        // Link clerkUserId if missing / changed
        if (!user.clerkUserId || user.clerkUserId !== clerkUserId) {
          console.log('🔗 Linking/updating Clerk account...');
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              clerkUserId,
              authProvider: user.passwordHash ? 'hybrid' : 'clerk',
              lastLogin: new Date(),
            },
          });
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
          });
        }

        // ✅ Back-fill username for existing users who don't have one yet
        if (!user.username && roleHasUsername(user.role)) {
          const username = await generateUniqueUsername(user.role);
          user = await prisma.user.update({
            where: { id: user.id },
            data: { username },
          });
          console.log('🎯 Back-filled username for existing user:', username);
        }

        // ✅ Pass subject so it gets stored in Teacher.specialties
        await this.ensureRoleRecord(user.id, user.role, division, subject);

      } else {
        // ── Create brand-new user ────────────────────────────
        console.log('🆕 Creating new user with role:', role);

        const autoPassword = this.generateSecurePassword();
        const passwordHash = await bcrypt.hash(autoPassword, 10);
        const fullName     = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();

        // ✅ Generate username before the transaction
        let username = null;
        if (roleHasUsername(role)) {
          username = await generateUniqueUsername(role);
          console.log('🎯 Generated username for new Clerk user:', username);
        }

        user = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email,
              clerkUserId,
              passwordHash,
              name:         fullName || null,
              avatar:       clerkUser.imageUrl || null,
              role,
              username,
              authProvider: 'hybrid',
              isActive:     true,
            },
          });

          console.log('✅ User created:', newUser.id);
          // ✅ Pass subject so it gets stored in Teacher.specialties
          await this.createRoleRecordInTransaction(tx, newUser.id, role, division, subject);
          return newUser;
        });

        console.log('✅ New user registration complete');
      }

      // ✅ FIX: fetch with relations so Teacher.specialties is included
      const fullUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { student: true, teacher: true, parent: true },
      });

      const token = generateToken({
        userId:       user.id,
        email:        user.email,
        role:         user.role,
        authProvider: user.authProvider,
      });

      console.log('✅ JWT token generated for user:', user.id);
      return { token, user: this.sanitizeUser(fullUser) };

    } catch (error) {
      console.error('❌ Clerk login error:', error);
      if (error.statusCode) throw error;
      const newError = new Error(error.message || 'Failed to authenticate with Clerk');
      newError.statusCode = 500;
      throw newError;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Generate secure random password
  // ─────────────────────────────────────────────────────────────
  generateSecurePassword() {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password  = '';
    password += this.getRandomChar('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    password += this.getRandomChar('abcdefghijklmnopqrstuvwxyz');
    password += this.getRandomChar('0123456789');
    for (let i = password.length; i < 16; i++) {
      password += this.getRandomChar(charset);
    }
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  getRandomChar(charset) {
    return crypto.randomInt(0, charset.length);
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Get current user
  // ✅ include student/teacher/parent so frontend gets specialties
  // ─────────────────────────────────────────────────────────────
  async getCurrentUser(userId) {
    const user = await prisma.user.findUnique({
      where:   { id: userId },
      include: { student: true, teacher: true, parent: true },
    });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return this.sanitizeUser(user);
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Update profile
  // ─────────────────────────────────────────────────────────────
  async updateProfile(userId, data) {
    const { name, phone, avatar } = data;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name   && { name }),
        ...(phone  && { phone }),
        ...(avatar && { avatar }),
      },
      include: { student: true, teacher: true, parent: true },
    });

    return this.sanitizeUser(user);
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Add password (Clerk hybrid)
  // ─────────────────────────────────────────────────────────────
  async addPassword(userId, password) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (user.passwordHash && user.authProvider !== 'clerk') {
      const error = new Error('User already has a password');
      error.statusCode = 400;
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, authProvider: 'hybrid' },
    });

    return { message: 'Password added successfully. You can now login with email/password.' };
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Change password
  // ─────────────────────────────────────────────────────────────
  async changePassword(userId, oldPassword, newPassword) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.passwordHash) {
      const error = new Error('Cannot change password for this account');
      error.statusCode = 400;
      throw error;
    }

    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) {
      const error = new Error('Current password is incorrect');
      error.statusCode = 401;
      throw error;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    return { message: 'Password changed successfully' };
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Role record helpers
  // ✅ accept `subject` param, store it in Teacher.specialties
  // ─────────────────────────────────────────────────────────────
  async createRoleRecord(userId, role, division = null, subject = null) {
    console.log('📝 Creating role record:', { userId, role, division, subject });
    try {
      switch (role) {
        case 'student':
          await prisma.student.create({
            data: { userId, coins: 0, gradeLevel: null, stream: division || null },
          });
          console.log('✅ Student record created');
          break;

        case 'teacher':
        case 'assistant_teacher':
          await prisma.teacher.create({
            data: {
              userId,
              verified: false,
              ratingAvg: 0,
              // ✅ Store chosen subject in specialties array
              specialties: subject ? [subject] : [],
            },
          });
          console.log('✅ Teacher record created with specialties:', subject ? [subject] : []);
          break;

        case 'parent':
          await prisma.parent.create({ data: { userId } });
          console.log('✅ Parent record created');
          break;

        default:
          console.log('⚠️ Unknown role:', role);
      }
    } catch (error) {
      console.error('❌ Error creating role record:', error);
      throw error;
    }
  }

  async createRoleRecordInTransaction(tx, userId, role, division = null, subject = null) {
    console.log('📝 Creating role record in transaction:', { userId, role, division, subject });
    switch (role) {
      case 'student':
        await tx.student.create({
          data: { userId, coins: 0, gradeLevel: null, stream: division || null },
        });
        break;

      case 'teacher':
      case 'assistant_teacher':
        await tx.teacher.create({
          data: {
            userId,
            verified: false,
            ratingAvg: 0,
            // ✅ Store chosen subject in specialties array
            specialties: subject ? [subject] : [],
          },
        });
        break;

      case 'parent':
        await tx.parent.create({ data: { userId } });
        break;
    }
  }

  async ensureRoleRecord(userId, role, division = null, subject = null) {
    console.log('🔍 Checking role record:', { userId, role, subject });
    try {
      switch (role) {
        case 'student': {
          const student = await prisma.student.findUnique({ where: { userId } });
          if (!student) {
            await prisma.student.create({
              data: { userId, coins: 0, gradeLevel: null, stream: division || null },
            });
            console.log('✅ Student record created');
          }
          break;
        }

        case 'teacher':
        case 'assistant_teacher': {
          const teacher = await prisma.teacher.findUnique({ where: { userId } });
          if (!teacher) {
            await prisma.teacher.create({
              data: {
                userId,
                verified: false,
                ratingAvg: 0,
                // ✅ Store chosen subject in specialties array
                specialties: subject ? [subject] : [],
              },
            });
            console.log('✅ Teacher record created with specialties:', subject ? [subject] : []);
          } else if (subject && (!teacher.specialties || teacher.specialties.length === 0)) {
            // ✅ Back-fill specialties if teacher exists but has none
            await prisma.teacher.update({
              where: { userId },
              data: { specialties: [subject] },
            });
            console.log('✅ Teacher specialties back-filled:', [subject]);
          }
          break;
        }

        case 'parent': {
          const parent = await prisma.parent.findUnique({ where: { userId } });
          if (!parent) {
            await prisma.parent.create({ data: { userId } });
            console.log('✅ Parent record created');
          }
          break;
        }
      }
    } catch (error) {
      console.error('❌ Error ensuring role record:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Debug helper
  // ─────────────────────────────────────────────────────────────
  async getUserCredentials(userId) {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, name: true, authProvider: true, clerkUserId: true, createdAt: true },
    });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Sanitize user — username is always included
  // ─────────────────────────────────────────────────────────────
  sanitizeUser(user) {
    const { passwordHash, ...sanitized } = user;
    return {
      ...sanitized,
      hasPassword: !!passwordHash,
    };
  }
}

export default new AuthService();