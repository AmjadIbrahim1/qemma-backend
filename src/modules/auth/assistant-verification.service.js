// backend/src/modules/auth/assistant-verification.service.js
// Supports two verification flows:
//   1. assistant_request  — assistant_teacher registration needs teacher approval
//   2. parent_request     — parent registration needs student approval
// Codes are stored in-memory (Map) with a 2-minute TTL.
// After generating a code → saves an in-app Notification + emits via Socket.IO

import crypto from "crypto";
import prisma from "../../config/prisma.config.js";
import notificationsService from "../notifications/notifications.service.js";

// Map<key, { code, requesterEmail, expiresAt }>
// key = `teacher:${teacherUsername}` or `student:${studentUsername}`
const pendingCodes = new Map();

const CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes

class AssistantVerificationService {
  // Socket.IO instance — injected once from server startup
  _io = null;

  setIO(io) {
    this._io = io;
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNAL: build map key
  // ─────────────────────────────────────────────────────────────
  _key(type, username) {
    return `${type}:${username}`;
  }

  // ─────────────────────────────────────────────────────────────
  // 1a. Send verification code — assistant → teacher
  // ─────────────────────────────────────────────────────────────
  async sendVerificationCode(teacherUsername, assistantEmail) {
    if (!teacherUsername || !assistantEmail) {
      const err = new Error("teacherUsername and assistantEmail are required");
      err.statusCode = 400;
      throw err;
    }

    const teacher = await prisma.user.findUnique({
      where: { username: teacherUsername },
      select: { id: true, username: true, name: true, role: true },
    });

    if (!teacher) {
      const err = new Error("لم يتم العثور على مدرس بهذا الاسم");
      err.statusCode = 404;
      throw err;
    }

    if (teacher.role !== "teacher") {
      const err = new Error("هذا المستخدم ليس مدرساً");
      err.statusCode = 400;
      throw err;
    }

    return this._generateAndSend({
      targetUser: teacher,
      requesterEmail: assistantEmail,
      notificationType: "assistant_request",
      mapKey: this._key("teacher", teacherUsername),
      titleFn: () => "🔔 طلب مدرس مساعد",
      bodyFn: (email, code, expiresAtStr) =>
        `شخص ما (${email}) يريد الانضمام كمدرس مساعد لك.\n\nكود التحقق: ${code}\n⏱ صالح حتى الساعة ${expiresAtStr} (دقيقتان فقط)`,
      extraData: { teacherUsername },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 1b. Send verification code — parent → student
  // ─────────────────────────────────────────────────────────────
  async sendParentVerificationCode(studentUsername, parentEmail) {
    if (!studentUsername || !parentEmail) {
      const err = new Error("studentUsername and parentEmail are required");
      err.statusCode = 400;
      throw err;
    }

    const student = await prisma.user.findUnique({
      where: { username: studentUsername },
      select: { id: true, username: true, name: true, role: true },
    });

    if (!student) {
      const err = new Error("لم يتم العثور على طالب بهذا الاسم المميز");
      err.statusCode = 404;
      throw err;
    }

    if (student.role !== "student") {
      const err = new Error("هذا المستخدم ليس طالباً");
      err.statusCode = 400;
      throw err;
    }

    return this._generateAndSend({
      targetUser: student,
      requesterEmail: parentEmail,
      notificationType: "parent_request",
      mapKey: this._key("student", studentUsername),
      titleFn: () => "👨‍👩‍👦 طلب ربط حساب ولي أمر",
      bodyFn: (email, code, expiresAtStr) =>
        `شخص ما (${email}) يريد ربط حسابه كولي أمر بحسابك.\n\nكود التحقق: ${code}\n⏱ صالح حتى الساعة ${expiresAtStr} (دقيقتان فقط)`,
      extraData: { studentUsername },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNAL: generate code, store, notify, emit
  // ─────────────────────────────────────────────────────────────
  async _generateAndSend({
    targetUser,
    requesterEmail,
    notificationType,
    mapKey,
    titleFn,
    bodyFn,
    extraData = {},
  }) {
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + CODE_TTL_MS;

    pendingCodes.set(mapKey, {
      code,
      requesterEmail,
      expiresAt,
    });

    console.log(
      `📨 Verification code [${notificationType}] for [${mapKey}]: ${code} (expires in 2 min)`,
    );

    const expiresAtStr = new Date(expiresAt).toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const title = titleFn();
    const body = bodyFn(requesterEmail, code, expiresAtStr);

    const notificationPayload = {
      userId: targetUser.id,
      type: notificationType,
      title,
      body,
      data: {
        code,
        requesterEmail,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlMinutes: 2,
        ...extraData,
      },
    };

    // Save to DB
    let savedNotification = null;
    try {
      savedNotification =
        await notificationsService.create(notificationPayload);
      console.log(`✅ Notification saved to DB for user: ${targetUser.id}`);
    } catch (notifError) {
      console.error(
        "❌ Failed to save notification to DB:",
        notifError.message,
      );
    }

    // Emit via Socket.IO in real-time
    if (this._io) {
      const roomName = `user:${targetUser.id}`;
      this._io.to(roomName).emit("notification:new", {
        ...(savedNotification || notificationPayload),
        id: savedNotification?.id || `temp-${Date.now()}`,
        type: notificationType,
        title,
        body,
        isRead: false,
        createdAt: new Date().toISOString(),
        data: notificationPayload.data,
      });
      console.log(`📡 Socket event emitted to room [${roomName}]`);
    } else {
      console.warn(
        "⚠️ Socket.IO not injected — real-time notification skipped",
      );
    }

    return {
      targetId: targetUser.id,
      targetName: targetUser.name,
      targetUsername: targetUser.username,
      code, // ← shown in response for dev/demo; remove in production
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 2a. Verify code — teacher flow
  // ─────────────────────────────────────────────────────────────
  verifyCode(teacherUsername, code) {
    return this._verifyCode(this._key("teacher", teacherUsername), code);
  }

  // ─────────────────────────────────────────────────────────────
  // 2b. Verify code — student/parent flow
  // ─────────────────────────────────────────────────────────────
  verifyParentCode(studentUsername, code) {
    return this._verifyCode(this._key("student", studentUsername), code);
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNAL: verify + consume code
  // ─────────────────────────────────────────────────────────────
  _verifyCode(mapKey, code) {
    const entry = pendingCodes.get(mapKey);

    if (!entry) {
      const err = new Error("لم يتم إرسال كود أو انتهت صلاحيته");
      err.statusCode = 400;
      throw err;
    }

    if (Date.now() > entry.expiresAt) {
      pendingCodes.delete(mapKey);
      const err = new Error("انتهت صلاحية الكود (دقيقتان). يرجى طلب كود جديد");
      err.statusCode = 400;
      throw err;
    }

    if (entry.code !== code.trim()) {
      const err = new Error("الكود غير صحيح");
      err.statusCode = 400;
      throw err;
    }

    pendingCodes.delete(mapKey);
    return { valid: true, requesterEmail: entry.requesterEmail };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Get teacher info by username (for UI preview)
  // ─────────────────────────────────────────────────────────────
  async getTeacherByUsername(username) {
    const teacher = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        avatar: true,
      },
    });

    if (!teacher || teacher.role !== "teacher") {
      const err = new Error("لم يتم العثور على مدرس بهذا الاسم");
      err.statusCode = 404;
      throw err;
    }

    return teacher;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Get student info by username (for UI preview)
  // ─────────────────────────────────────────────────────────────
  async getStudentByUsername(username) {
    const student = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        avatar: true,
      },
    });

    if (!student || student.role !== "student") {
      const err = new Error("لم يتم العثور على طالب بهذا الاسم المميز");
      err.statusCode = 404;
      throw err;
    }

    return student;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Cleanup expired codes (call on a cron)
  // ─────────────────────────────────────────────────────────────
  cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of pendingCodes.entries()) {
      if (now > entry.expiresAt) pendingCodes.delete(key);
    }
  }
}

export default new AssistantVerificationService();
