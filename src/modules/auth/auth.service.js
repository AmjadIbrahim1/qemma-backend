// backend/src/modules/auth/auth.service.js

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma.config.js';
import clerkClient from '../../config/clerk.config.js';
import { generateToken } from '../../shared/utils/jwt.util.js';
import { generateUniqueUsername, roleHasUsername } from '../../shared/utils/username.util.js';
import { getStreamFromSubject } from './subject-stream.map.js';   // ✅ NEW: teacher stream derivation from subject

class AuthService {

  // ─────────────────────────────────────────────────────────────
  // 🔵 LOCAL REGISTRATION
  // ─────────────────────────────────────────────────────────────
  async registerLocal(data) {
    const {
      email, password, name, role = 'student',
      phone, division, subject, teacherName, studentUsername,
      year, stream,   // ✅ NEW: year (Student.year enum) + stream (Teacher.stream)
    } = data;

    console.log('📝 Registration request:', { email, role, division, subject, studentUsername, teacherName });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }

    if (phone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone } });
      if (existingPhone) {
        const error = new Error('رقم الهاتف مستخدم بالفعل، يرجى إدخال رقم آخر');
        error.statusCode = 400;
        throw error;
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let username = null;
    if (roleHasUsername(role)) {
      username = await generateUniqueUsername(role);
      console.log('🎯 Generated username:', username, 'for role:', role);
    }

    const user = await prisma.user.create({
      data: { email, passwordHash, name, role, phone, username, authProvider: 'local' },
    });

    console.log('✅ User created:', user.id, '| Role:', user.role, '| Username:', user.username);

    await this.createRoleRecord(user.id, role, division, subject, teacherName, studentUsername, year, stream);

    const fullUser = await prisma.user.findUnique({
      where:   { id: user.id },
      include: { student: true, teacher: true, parent: true },
    });

    const token = generateToken({
      userId:       user.id,
      email:        user.email,
      role:         user.role,
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
      data:  { lastLogin: new Date() },
    });

    const fullUser = await prisma.user.findUnique({
      where:   { id: user.id },
      include: { student: true, teacher: true, parent: true },
    });

    const token = generateToken({
      userId:       user.id,
      email:        user.email,
      role:         user.role,
      authProvider: user.authProvider,
    });

    return { token, user: this.sanitizeUser(fullUser) };
  }

  // ─────────────────────────────────────────────────────────────
  // 🟢 CLERK LOGIN / REGISTER
  // ─────────────────────────────────────────────────────────────
  async loginClerk(
    clerkUserId,
    role           = 'student',
    division       = null,
    subject        = null,
    teacherName    = null,
    studentUsername = null,
    year           = null,   // Student.year (enum)
    stream         = null,   // Teacher.stream
    phone          = null,
  ) {
    try {
      console.log('🔍 Clerk Login Request:', { clerkUserId, role, division, subject, teacherName, studentUsername });

      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      if (!clerkUser) {
        const error = new Error('Clerk user not found');
        error.statusCode = 404;
        throw error;
      }

      const email = clerkUser.emailAddresses[0]?.emailAddress;
      if (!email) {
        const error = new Error('No email found in Clerk account');
        error.statusCode = 400;
        throw error;
      }

      // ── Try to find existing user ──────────────────────────
      let user = await prisma.user.findFirst({ where: { clerkUserId } });
      if (!user) user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        console.log('👤 Existing user found:', user.id);

        const updateData = {};
        let needsUpdate = false;

        if (!user.clerkUserId || user.clerkUserId !== clerkUserId) {
          updateData.clerkUserId = clerkUserId;
          updateData.authProvider = user.passwordHash ? 'hybrid' : 'clerk';
          needsUpdate = true;
        }

        updateData.lastLogin = new Date();

        if (needsUpdate) {
          user = await prisma.user.update({
            where: { id: user.id },
            data:  updateData,
          });
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data:  { lastLogin: new Date() },
          });
        }

        if (!user.username && roleHasUsername(user.role)) {
          const username = await generateUniqueUsername(user.role);
          user = await prisma.user.update({
            where: { id: user.id },
            data:  { username },
          });
          console.log('🎯 Back-filled username:', username);
        }

        await this.ensureRoleRecord(user.id, user.role, division, subject, teacherName, studentUsername, year, stream);

      } else {
        // ── Create brand-new user ────────────────────────────
        console.log('🆕 Creating new user with role:', role);

        if (phone) {
          const phoneExists = await prisma.user.findFirst({ where: { phone } });
          if (phoneExists) {
            const error = new Error('رقم الهاتف مستخدم بالفعل، يرجى إدخال رقم آخر');
            error.statusCode = 400;
            throw error;
          }
        }

        const autoPassword = this.generateSecurePassword();
        const passwordHash = await bcrypt.hash(autoPassword, 10);
        const fullName     = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();

        let username = null;
        if (roleHasUsername(role)) {
          username = await generateUniqueUsername(role);
          console.log('🎯 Generated username:', username, 'role:', role);
        }

        // Create user + role record; handle parent linking after transaction
        let createdParentId = null;

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
                phone: phone || null,
                authProvider: 'hybrid',
                isActive:     true,
              },
            });

          console.log('✅ User created:', { id: newUser.id });

          const parentId = await this._createRoleRecordInTransaction(
            tx, newUser.id, role, division, subject, teacherName, year, stream,
          );

          // Store parentId so we can link after transaction
          if (parentId) createdParentId = parentId;

          return newUser;
        });

        // ── Link parent → student AFTER transaction ──────────
        if (role === 'parent' && createdParentId && studentUsername) {
          await this._linkParentToStudent(createdParentId, studentUsername);
        }

        console.log('✅ New user registration complete');
      }

      const fullUser = await prisma.user.findUnique({
        where:   { id: user.id },
        include: { student: true, teacher: true, parent: true },
      });

      const token = generateToken({
        userId:       user.id,
        email:        user.email,
        role:         user.role,
        authProvider: user.authProvider,
      });

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
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[crypto.randomInt(0, 26)];
    password += 'abcdefghijklmnopqrstuvwxyz'[crypto.randomInt(0, 26)];
    password += '0123456789'[crypto.randomInt(0, 10)];
    for (let i = password.length; i < 16; i++) {
      password += charset[crypto.randomInt(0, charset.length)];
    }
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Get current user
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
  // 🔹 Add password
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
    await prisma.user.update({ where: { id: userId }, data: { passwordHash, authProvider: 'hybrid' } });
    return { message: 'Password added successfully.' };
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
  // 🔹 createRoleRecord — used for local registration
  // ─────────────────────────────────────────────────────────────
  async createRoleRecord(userId, role, division = null, subject = null, teacherName = null, studentUsername = null, year = null, stream = null) {
    console.log('📝 Creating role record:', { userId, role, division, subject, teacherName, studentUsername });
    try {
      switch (role) {
        case 'student':
          await prisma.student.create({
            data: { userId, coins: 0, gradeLevel: null, stream: division || null, year: year || null },   // ✅ NEW: persist Student.year (enum)
          });
          console.log('✅ Student record created');
          break;

        case 'teacher':
        case 'assistant_teacher': {
          let linkData = {};
          if (role === 'assistant_teacher' && teacherName) {
            try {
              const mainTeacherUser = await prisma.user.findUnique({
                where:  { username: teacherName },
                select: { id: true },
              });
              if (mainTeacherUser) {
                const mainTeacherRecord = await prisma.teacher.findUnique({
                  where: { userId: mainTeacherUser.id },
                });
                if (mainTeacherRecord) {
                  linkData.linkedTeacherId = mainTeacherRecord.id;
                  console.log('✅ Assistant linked to teacher:', mainTeacherRecord.id);
                }
              }
            } catch (linkErr) {
              console.warn('⚠️ Could not link assistant teacher:', linkErr.message);
            }
          }
          await prisma.teacher.create({
            data: {
              userId,
              verified:    false,
              ratingAvg:   0,
              specialties: Array.isArray(subject) ? subject : (subject ? [subject] : []),
              stream: stream || getStreamFromSubject(subject) || null,   // ✅ NEW: derive Teacher.stream from subject if not explicitly provided
              ...linkData,
            },
          });
          console.log('✅ Teacher record created');
          break;
        }

        case 'parent': {
          const parent = await prisma.parent.create({ data: { userId } });
          console.log('✅ Parent record created:', parent.id);

          if (studentUsername) {
            await this._linkParentToStudent(parent.id, studentUsername);
          }
          break;
        }

        default:
          console.log('⚠️ Unknown role:', role);
      }
    } catch (error) {
      console.error('❌ Error creating role record:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 _createRoleRecordInTransaction — used inside Clerk transaction
  //    Returns parentId if role === 'parent', else null
  // ─────────────────────────────────────────────────────────────
  async _createRoleRecordInTransaction(tx, userId, role, division = null, subject = null, teacherName = null, year = null, stream = null) {
    switch (role) {
      case 'student':
        await tx.student.create({
          data: { userId, coins: 0, gradeLevel: null, stream: division || null, year: year || null },   // ✅ NEW: persist Student.year (enum)
        });
        return null;

      case 'teacher':
      case 'assistant_teacher': {
        let linkData = {};
        if (role === 'assistant_teacher' && teacherName) {
          try {
            // Use prisma (not tx) for lookup — it's a read, safe outside tx
            const mainTeacherUser = await prisma.user.findUnique({
              where:  { username: teacherName },
              select: { id: true },
            });
            if (mainTeacherUser) {
              const mainTeacherRecord = await prisma.teacher.findUnique({
                where: { userId: mainTeacherUser.id },
              });
              if (mainTeacherRecord) {
                linkData.linkedTeacherId = mainTeacherRecord.id;
                console.log('✅ Transaction: Assistant linked to teacher:', mainTeacherRecord.id);
              }
            }
          } catch (linkErr) {
            console.warn('⚠️ Transaction: Could not link assistant teacher:', linkErr.message);
          }
        }
        await tx.teacher.create({
          data: {
            userId,
            verified:    false,
            ratingAvg:   0,
            specialties: Array.isArray(subject) ? subject : (subject ? [subject] : []),
            stream: stream || getStreamFromSubject(subject) || null,   // ✅ NEW: derive Teacher.stream from subject if not explicitly provided
            ...linkData,
          },
        });
        return null;
      }

      case 'parent': {
        const parent = await tx.parent.create({ data: { userId } });
        console.log('✅ Transaction: Parent record created:', parent.id);
        // Return parentId so caller can link after transaction
        return parent.id;
      }

      default:
        return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 ensureRoleRecord — used for existing Clerk users
  // ─────────────────────────────────────────────────────────────
  async ensureRoleRecord(userId, role, division = null, subject = null, teacherName = null, studentUsername = null, year = null, stream = null) {
    console.log('🔍 Ensuring role record:', { userId, role, subject, teacherName, studentUsername });
    try {
      switch (role) {
        case 'student': {
          const student = await prisma.student.findUnique({ where: { userId } });
          if (!student) {
            await prisma.student.create({
              data: { userId, coins: 0, gradeLevel: null, stream: division || null, year: year || null },   // ✅ NEW: persist Student.year (enum)
            });
            console.log('✅ ensureRoleRecord: Student created');
          }
          break;
        }

        case 'teacher':
        case 'assistant_teacher': {
          const teacher = await prisma.teacher.findUnique({ where: { userId } });
          if (!teacher) {
            let linkData = {};
            if (role === 'assistant_teacher' && teacherName) {
              try {
                const mainTeacherUser = await prisma.user.findUnique({
                  where:  { username: teacherName },
                  select: { id: true },
                });
                if (mainTeacherUser) {
                  const mainTeacherRecord = await prisma.teacher.findUnique({
                    where: { userId: mainTeacherUser.id },
                  });
                  if (mainTeacherRecord) {
                    linkData.linkedTeacherId = mainTeacherRecord.id;
                  }
                }
              } catch (linkErr) {
                console.warn('⚠️ ensureRoleRecord: Could not link assistant:', linkErr.message);
              }
            }
            await prisma.teacher.create({
              data: {
                userId,
                verified:    false,
                ratingAvg:   0,
                specialties: subject ? [subject] : [],
                stream: stream || getStreamFromSubject(subject) || null,   // ✅ NEW: derive Teacher.stream from subject if not explicitly provided
                ...linkData,
              },
            });
            console.log('✅ ensureRoleRecord: Teacher created');
          } else if (subject && (!teacher.specialties || teacher.specialties.length === 0)) {
            await prisma.teacher.update({ where: { userId }, data: { specialties: [subject] } });
          }
          break;
        }

        case 'parent': {
          let parent = await prisma.parent.findUnique({ where: { userId } });
          if (!parent) {
            parent = await prisma.parent.create({ data: { userId } });
            console.log('✅ ensureRoleRecord: Parent created:', parent.id);
          }

          // Always try to link if studentUsername is provided
          if (studentUsername) {
            await this._linkParentToStudent(parent.id, studentUsername);
          }
          break;
        }
      }
    } catch (error) {
      console.error('❌ Error ensuring role record:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 _linkParentToStudent — core linking logic
  // ─────────────────────────────────────────────────────────────
  async _linkParentToStudent(parentId, studentUsername) {
    try {
      console.log('🔗 Linking parent', parentId, '→ student username:', studentUsername);

      const studentUser = await prisma.user.findUnique({
        where:  { username: studentUsername },
        select: { id: true, role: true },
      });

      if (!studentUser) {
        console.warn('⚠️ Student not found with username:', studentUsername);
        return;
      }

      if (studentUser.role !== 'student') {
        console.warn('⚠️ User is not a student:', studentUsername);
        return;
      }

      const studentRecord = await prisma.student.findUnique({
        where: { userId: studentUser.id },
      });

      if (!studentRecord) {
        console.warn('⚠️ Student record not found for userId:', studentUser.id);
        return;
      }

      if (studentRecord.parentId === parentId) {
        console.log('ℹ️ Student already linked to this parent, skipping.');
        return;
      }

      await prisma.student.update({
        where: { id: studentRecord.id },
        data:  { parentId },
      });

      console.log('✅ Parent linked to student successfully. Student ID:', studentRecord.id);
    } catch (err) {
      console.warn('⚠️ Could not link parent to student:', err.message);
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
  // 🔹 Check phone availability (public, no auth required)
  // ─────────────────────────────────────────────────────────────
  async checkPhone(phone) {
    const existing = await prisma.user.findFirst({ where: { phone } });
    if (existing) {
      const error = new Error('رقم الهاتف مستخدم بالفعل، يرجى إدخال رقم آخر');
      error.statusCode = 400;
      throw error;
    }
    return { available: true };
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Update user phone (with uniqueness check)
  // ─────────────────────────────────────────────────────────────
  async updateUserPhone(userId, phone) {
    const existing = await prisma.user.findFirst({
      where: { phone, NOT: { id: userId } },
    });
    if (existing) {
      const error = new Error('رقم الهاتف مستخدم بالفعل، يرجى إدخال رقم آخر');
      error.statusCode = 400;
      throw error;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data:  { phone },
      include: { student: true, teacher: true, parent: true },
    });

    return this.sanitizeUser(user);
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 Sanitize user
  // ─────────────────────────────────────────────────────────────
  sanitizeUser(user) {
    const { passwordHash, ...sanitized } = user;
    return { ...sanitized, hasPassword: !!passwordHash };
  }
}

export default new AuthService();