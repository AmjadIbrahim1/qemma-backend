// backend/src/modules/notifications/notifications.routes.js

import express from "express";
import notificationsController from "./notifications.controller.js";
import { authMiddleware } from "../auth/auth.middleware.js";

const router = express.Router();
router.use(authMiddleware);

// Teacher send
router.post("/send", notificationsController.sendNotification);
router.get("/teacher/courses", notificationsController.getTeacherCourses);
router.get("/teacher/students", notificationsController.getTeacherStudents);

// User routes
router.get("/", notificationsController.getMyNotifications);
router.get("/unread-count", notificationsController.getUnreadCount);
router.patch("/read-all", notificationsController.markAllAsRead);
router.patch("/:id/read", notificationsController.markAsRead);
router.delete("/", notificationsController.deleteAll);
router.delete("/:id", notificationsController.deleteOne);

export default router;
