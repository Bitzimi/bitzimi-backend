import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import {
  listNotifications, getUnreadCount, markRead, markAllRead,
  deleteNotification, deleteAllNotifications, broadcastNotification,
} from "./notifications.service";

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/notifications — paginated list (newest first)
  app.get("/", async (req, reply) => {
    const q = z.object({
      cursor: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(50).default(30),
    }).parse(req.query);
    return reply.send({ data: await listNotifications(req.user.sub, q) });
  });

  // GET /api/v1/notifications/unread-count — badge counter
  app.get("/unread-count", async (req, reply) => {
    const count = await getUnreadCount(req.user.sub);
    return reply.send({ data: { count } });
  });

  // PATCH /api/v1/notifications/:id/read — mark single as read
  app.patch("/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    await markRead(req.user.sub, id);
    return reply.status(204).send();
  });

  // POST /api/v1/notifications/read-all — mark all as read
  app.post("/read-all", async (req, reply) => {
    await markAllRead(req.user.sub);
    return reply.status(204).send();
  });

  // DELETE /api/v1/notifications/all — delete all notifications for user
  app.delete("/all", async (req, reply) => {
    await deleteAllNotifications(req.user.sub);
    return reply.status(204).send();
  });

  // DELETE /api/v1/notifications/:id — delete single notification
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteNotification(req.user.sub, id);
    return reply.status(204).send();
  });

  // POST /api/v1/notifications/broadcast — admin only
  app.post("/broadcast", { onRequest: [requirePermission("admin.notifications.broadcast")] }, async (req, reply) => {
    const body = z.object({
      type:     z.string().min(1),
      title:    z.string().min(1).max(120),
      message:  z.string().min(1).max(500),
      segment:  z.enum(["all","vip","verified"]).default("all"),
      metadata: z.record(z.any()).optional(),
    }).parse(req.body);
    const data = await broadcastNotification(body);
    return reply.send({ data });
  });
}
