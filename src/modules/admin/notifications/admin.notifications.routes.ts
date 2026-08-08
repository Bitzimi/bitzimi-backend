import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminGetNotificationStats,
  adminListNotifications,
  adminDeleteNotification,
  adminDeleteUserNotifications,
  adminListNotificationTypes,
} from "./admin.notifications.service";
import { broadcastNotification } from "../../notifications/notifications.service";

export async function adminNotificationsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/notifications/stats
  app.get("/stats", { onRequest: [requirePermission("admin.notifications.view")] }, async (_req, reply) => {
    const data = await adminGetNotificationStats();
    return reply.send({ data });
  });

  // GET /api/v1/admin/notifications/types
  app.get("/types", { onRequest: [requirePermission("admin.notifications.view")] }, async (_req, reply) => {
    const data = await adminListNotificationTypes();
    return reply.send({ data });
  });

  // GET /api/v1/admin/notifications
  app.get("/", { onRequest: [requirePermission("admin.notifications.view")] }, async (req, reply) => {
    const query = z.object({
      userId: z.string().optional(),
      type:   z.string().optional(),
      read:   z.enum(["true", "false"]).transform(v => v === "true").optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListNotifications(query);
    return reply.send({ data });
  });

  // DELETE /api/v1/admin/notifications/:id — delete single notification
  app.delete("/:id", { onRequest: [requirePermission("admin.notifications.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminDeleteNotification(id);
    return reply.send({ data });
  });

  // DELETE /api/v1/admin/notifications/user/:userId — clear all for user
  app.delete("/user/:userId", { onRequest: [requirePermission("admin.notifications.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const data = await adminDeleteUserNotifications(userId);
    return reply.send({ data });
  });

  // POST /api/v1/admin/notifications/broadcast — send global announcement
  app.post("/broadcast", { onRequest: [requirePermission("admin.notifications.broadcast")] }, async (req, reply) => {
    const body = z.object({
      type:     z.string().min(1).max(60),
      title:    z.string().min(1).max(200),
      message:  z.string().min(1).max(2000),
      segment:  z.enum(["all", "vip", "verified"]),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const data = await broadcastNotification(body);
    return reply.send({ data });
  });
}
