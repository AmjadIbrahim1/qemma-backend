// backend/src/modules/auth/auth.service.js - FIXED for assistant_teacher
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../../config/prisma.config.js';
import clerkClient from '../../config/clerk.config.js';
import { generateToken } from '../../shared/utils/jwt.util.js';

class AuthService {
  /**
   * 🔵 LOCAL REGISTRATION (Email/Password) - ✅ FIXED for assistant_teacher
   */
  async registerLocal(data) {
    const { email, password, name, role = 'student', phone, division } = data;

    console.log('📝 Registration request:', { email, role, division });

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

    console.log('✅ User created:', user.id, 'Role:', user.role);

    // Create role-specific record
    await this.createRoleRecord(user.id, role, division);

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
   * 🟢 CLERK LOGIN/REGISTER
   */
  async loginClerk(clerkUserId, role = 'student', division = null) {
    try {
      console.log('🔍 Clerk Login Request:', { clerkUserId, role, division });

      // Step 1: Get Clerk user data
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      
      if (!clerkUser) {
        console.error('❌ Clerk user not found');
        const error = new Error('Clerk user not found');
        error.statusCode = 404;
        throw error;
      }

      const email = clerkUser.emailAddresses[0]?.emailAddress;
      console.log('✅ Clerk user found:', {
        id: clerkUser.id,
        email: email,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
      });

      if (!email) {
        const error = new Error('No email found in Clerk account');
        error.statusCode = 400;
        throw error;
      }

      // Step 2: Try to find existing user by clerkUserId FIRST, then by email
      let user = await prisma.user.findFirst({
        where: {
          clerkUserId: clerkUserId,
        },
      });

      // If not found by clerkUserId, try by email
      if (!user) {
        console.log('👤 User not found by clerkUserId, trying email...');
        user = await prisma.user.findUnique({
          where: { email: email },
        });
      }

      if (user) {
        console.log('👤 Existing user found:', user.id);
        
        // Step 3: Update user's clerkUserId if it's missing or different
        if (!user.clerkUserId || user.clerkUserId !== clerkUserId) {
          console.log('🔗 Linking/updating Clerk account...');
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              clerkUserId: clerkUserId,
              authProvider: user.passwordHash ? 'hybrid' : 'clerk',
              lastLogin: new Date(),
            },
          });
          console.log('✅ Clerk account linked');
        } else {
          // Just update last login
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
          });
          console.log('✅ Last login updated');
        }
        
        // Step 4: Ensure role record exists
        await this.ensureRoleRecord(user.id, user.role, division);
      } else {
        // Step 5: Create new user
        console.log('🆕 Creating new user with role:', role);
        
        // Generate secure auto-password
        const autoPassword = this.generateSecurePassword();
        const passwordHash = await bcrypt.hash(autoPassword, 10);
        
        const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();
        
        // Create user with transaction
        user = await prisma.$transaction(async (tx) => {
          // Create user
          const newUser = await tx.user.create({
            data: {
              email: email,
              clerkUserId: clerkUserId,
              passwordHash: passwordHash,
              name: fullName || null,
              avatar: clerkUser.imageUrl || null,
              role: role,
              authProvider: 'hybrid',
              isActive: true,
            },
          });

          console.log('✅ User created:', newUser.id);

          // Create role record based on role
          await this.createRoleRecordInTransaction(tx, newUser.id, role, division);

          return newUser;
        });

        console.log('✅ New user registration complete');
      }

      // Step 6: Generate JWT token
      const token = generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        authProvider: user.authProvider,
      });

      console.log('✅ JWT token generated for user:', user.id);

      return {
        token,
        user: this.sanitizeUser(user),
      };
    } catch (error) {
      console.error('❌ Clerk login error:', error);
      
      // Don't wrap errors that already have statusCode
      if (error.statusCode) {
        throw error;
      }
      
      // Wrap other errors
      const newError = new Error(error.message || 'Failed to authenticate with Clerk');
      newError.statusCode = 500;
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
   * 🔹 Helper: Create role record (outside transaction) - ✅ FIXED for assistant_teacher
   */
  async createRoleRecord(userId, role, division = null) {
    console.log('📝 Creating role record:', { userId, role, division });
    
    try {
      switch (role) {
        case 'student':
          await prisma.student.create({ 
            data: { 
              userId,
              coins: 0,
              gradeLevel: null,
              stream: division || null,
            } 
          });
          console.log('✅ Student record created');
          break;
        case 'teacher':
          await prisma.teacher.create({ 
            data: { 
              userId,
              verified: false,
              ratingAvg: 0,
            } 
          });
          console.log('✅ Teacher record created');
          break;
        // ✅ FIXED: Properly handle assistant_teacher
        case 'assistant_teacher':
          await prisma.teacher.create({ 
            data: { 
              userId,
              verified: false,
              ratingAvg: 0,
            } 
          });
          console.log('✅ Assistant teacher record created');
          break;
        case 'parent':
          await prisma.parent.create({ 
            data: { userId } 
          });
          console.log('✅ Parent record created');
          break;
        default:
          console.log('⚠️ Unknown role:', role);
          break;
      }
    } catch (error) {
      console.error('❌ Error creating role record:', error);
      throw error;
    }
  }

  /**
   * 🔹 Helper: Create role record (inside transaction) - ✅ FIXED for assistant_teacher
   */
  async createRoleRecordInTransaction(tx, userId, role, division = null) {
    console.log('📝 Creating role record in transaction:', { userId, role, division });
    
    switch (role) {
      case 'student':
        await tx.student.create({ 
          data: { 
            userId,
            coins: 0,
            gradeLevel: null,
            stream: division || null,
          } 
        });
        console.log('✅ Student record created in transaction');
        break;
      case 'teacher':
        await tx.teacher.create({ 
          data: { 
            userId,
            verified: false,
            ratingAvg: 0,
          } 
        });
        console.log('✅ Teacher record created in transaction');
        break;
      // ✅ FIXED: Properly handle assistant_teacher
      case 'assistant_teacher':
        await tx.teacher.create({ 
          data: { 
            userId,
            verified: false,
            ratingAvg: 0,
          } 
        });
        console.log('✅ Assistant teacher record created in transaction');
        break;
      case 'parent':
        await tx.parent.create({ 
          data: { userId } 
        });
        console.log('✅ Parent record created in transaction');
        break;
    }
  }

  /**
   * 🔹 Helper: Ensure role record exists - ✅ FIXED for assistant_teacher
   */
  async ensureRoleRecord(userId, role, division = null) {
    console.log('🔍 Checking role record:', { userId, role });
    
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
                stream: division || null,
              } 
            });
            console.log('✅ Student record created');
          } else {
            console.log('✓ Student record exists');
          }
          break;
        case 'teacher':
        case 'assistant_teacher': // ✅ Both use teacher table
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
          } else {
            console.log('✓ Teacher record exists');
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
          } else {
            console.log('✓ Parent record exists');
          }
          break;
      }
    } catch (error) {
      console.error('❌ Error ensuring role record:', error);
      // Don't throw - this is a safety check, not critical
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