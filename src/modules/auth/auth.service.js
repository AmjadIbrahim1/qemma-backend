// backend/src/modules/auth/auth.service.js - COMPLETE FILE
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma.config.js';
import clerkClient from '../../config/clerk.config.js';
import { generateToken } from '../../shared/utils/jwt.util.js';

class AuthService {
  /**
   * 🔵 LOCAL REGISTRATION (Email/Password)
   */
  async registerLocal(data) {
    const { email, password, name, role = 'student', phone } = data;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        phone,
        authProvider: 'local',
      },
    });

    // Create role-specific record
    await this.createRoleRecord(user.id, role);

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authProvider: 'local',
    });

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * 🔵 LOCAL LOGIN (Email/Password)
   */
  async loginLocal(email, password) {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Check if user has password
    if (!user.passwordHash) {
      const error = new Error('Please login with Google. No password set for this account.');
      error.statusCode = 400;
      throw error;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authProvider: user.authProvider,
    });

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * 🟢 CLERK LOGIN/REGISTER - COMPLETE FIX ✅
   */
  async loginClerk(clerkUserId, role = 'student') {
    try {
      console.log('🔍 Clerk Login - User ID:', clerkUserId, 'Role:', role);

      // Get Clerk user
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      
      if (!clerkUser) {
        const error = new Error('Clerk user not found');
        error.statusCode = 404;
        throw error;
      }

      console.log('✅ Clerk user found:', {
        id: clerkUser.id,
        email: clerkUser.emailAddresses[0]?.emailAddress,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
      });

      const email = clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        const error = new Error('No email found in Clerk account');
        error.statusCode = 400;
        throw error;
      }

      // ✅ FIX: Find user by clerkUserId OR email
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { clerkUserId },
            { email },
          ],
        },
      });

      if (user) {
        console.log('👤 Existing user found:', user.id);
        
        // ✅ FIX: Update clerkUserId if it changed or wasn't set
        if (!user.clerkUserId || user.clerkUserId !== clerkUserId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              clerkUserId,
              authProvider: user.passwordHash ? 'hybrid' : 'clerk',
              lastLogin: new Date(),
            },
          });
          console.log('🔗 Clerk account linked/updated');
        } else {
          // Just update last login
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
          });
        }
        
        // ✅ FIX: Ensure role record exists
        await this.ensureRoleRecord(user.id, user.role);
      } else {
        console.log('🆕 Creating new user with role:', role);
        
        // Generate secure password
        const autoPassword = this.generateSecurePassword();
        const passwordHash = await bcrypt.hash(autoPassword, 10);
        
        const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();
        
        // ✅ Create user with transaction to ensure consistency
        user = await prisma.$transaction(async (tx) => {
          // Create user
          const newUser = await tx.user.create({
            data: {
              email,
              clerkUserId,
              passwordHash,
              name: fullName || null,
              avatar: clerkUser.imageUrl || null,
              role: role,
              authProvider: 'hybrid',
              isActive: true,
            },
          });

          // Create role record
          switch (role) {
            case 'student':
              await tx.student.create({ 
                data: { 
                  userId: newUser.id,
                  coins: 0,
                  gradeLevel: null,
                  stream: null,
                } 
              });
              break;
            case 'teacher':
              await tx.teacher.create({ 
                data: { 
                  userId: newUser.id,
                  verified: false,
                  ratingAvg: 0,
                } 
              });
              break;
            case 'parent':
              await tx.parent.create({ 
                data: { userId: newUser.id } 
              });
              break;
          }

          return newUser;
        });

        console.log('✅ New user created with auto-generated password');
        console.log(`✅ ${role} record created in transaction`);
      }

      // Generate backend JWT
      const token = generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        authProvider: user.authProvider,
      });

      console.log('✅ JWT token generated');

      return {
        token,
        user: this.sanitizeUser(user),
      };
    } catch (error) {
      console.error('❌ Clerk login error:', error);
      
      if (error.statusCode) {
        throw error;
      }
      
      const newError = new Error(error.message || 'Failed to authenticate with Clerk');
      newError.statusCode = 401;
      throw newError;
    }
  }

  /**
   * 🔹 Generate secure random password
   */
  generateSecurePassword() {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    
    // Ensure at least one of each type
    password += this.getRandomChar('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    password += this.getRandomChar('abcdefghijklmnopqrstuvwxyz');
    password += this.getRandomChar('0123456789');
    
    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += this.getRandomChar(charset);
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * 🔹 Get random character from charset
   */
  getRandomChar(charset) {
    const randomIndex = crypto.randomInt(0, charset.length);
    return charset[randomIndex];
  }

  /**
   * 🔹 Get current user
   */
  async getCurrentUser(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        student: true,
        teacher: true,
        parent: true,
      },
    });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return this.sanitizeUser(user);
  }

  /**
   * 🔹 Update profile
   */
  async updateProfile(userId, data) {
    const { name, phone, avatar } = data;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { 
        ...(name && { name }),
        ...(phone && { phone }),
        ...(avatar && { avatar }),
      },
    });

    return this.sanitizeUser(user);
  }

  /**
   * 🔹 Add password to Clerk user (Hybrid mode)
   */
  async addPassword(userId, password) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

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
      data: { 
        passwordHash,
        authProvider: 'hybrid',
      },
    });

    return { 
      message: 'Password added successfully. You can now login with email/password.' 
    };
  }

  /**
   * 🔹 Change password
   */
  async changePassword(userId, oldPassword, newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      const error = new Error('Cannot change password for this account');
      error.statusCode = 400;
      throw error;
    }

    // Verify old password
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) {
      const error = new Error('Current password is incorrect');
      error.statusCode = 401;
      throw error;
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * 🔹 Helper: Create role record
   */
  async createRoleRecord(userId, role) {
    switch (role) {
      case 'student':
        await prisma.student.create({ 
          data: { 
            userId,
            coins: 0,
            gradeLevel: null,
            stream: null,
          } 
        });
        break;
      case 'teacher':
        await prisma.teacher.create({ 
          data: { 
            userId,
            verified: false,
            ratingAvg: 0,
          } 
        });
        break;
      case 'parent':
        await prisma.parent.create({ 
          data: { userId } 
        });
        break;
      default:
        break;
    }
  }

  /**
   * 🔹 Helper: Ensure role record exists (NEW)
   */
  async ensureRoleRecord(userId, role) {
    try {
      switch (role) {
        case 'student':
          const student = await prisma.student.findUnique({
            where: { userId },
          });
          if (!student) {
            await prisma.student.create({ 
              data: { 
                userId,
                coins: 0,
                gradeLevel: null,
                stream: null,
              } 
            });
            console.log('✅ Student record created');
          }
          break;
        case 'teacher':
          const teacher = await prisma.teacher.findUnique({
            where: { userId },
          });
          if (!teacher) {
            await prisma.teacher.create({ 
              data: { 
                userId,
                verified: false,
                ratingAvg: 0,
              } 
            });
            console.log('✅ Teacher record created');
          }
          break;
        case 'parent':
          const parent = await prisma.parent.findUnique({
            where: { userId },
          });
          if (!parent) {
            await prisma.parent.create({ 
              data: { userId } 
            });
            console.log('✅ Parent record created');
          }
          break;
      }
    } catch (error) {
      console.error('❌ Error ensuring role record:', error);
    }
  }

  /**
   * 🔹 Get user credentials (Admin only - for debugging)
   */
  async getUserCredentials(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        authProvider: true,
        clerkUserId: true,
        createdAt: true,
      },
    });

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  /**
   * 🔹 Helper: Sanitize user
   */
  sanitizeUser(user) {
    const { passwordHash, ...sanitized } = user;
    return {
      ...sanitized,
      hasPassword: !!passwordHash,
    };
  }
}

export default new AuthService();