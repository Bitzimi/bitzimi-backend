import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminGetVipStats,
  adminListVipMembers,
  adminGetVipMemberDetail,
  adminCancelVipSubscription,
  adminResetVipStreak,
} from "./admin.vip.service";

export async function adminVipRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/vip/stats — platform-wide VIP statistics
  app.get("/stats", { onRequest: [requirePermission("admin.vip.view")] }, async (_req, reply) => {
    const data = await adminGetVipStats();
    return reply.send({ data });
  });

  // GET /api/v1/admin/vip/members — paginated list of VIP members
  app.get("/members", { onRequest: [requirePermission("admin.vip.view")] }, async (req, reply) => {
    const query = z.object({
      search: z.string().optional(),
      status: z.enum(["active", "expired", "all"]).optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListVipMembers(query);
    return reply.send({ data });
  });

  // GET /api/v1/admin/vip/members/:userId — VIP member detail
  app.get("/members/:userId", { onRequest: [requirePermission("admin.vip.view")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const data = await adminGetVipMemberDetail(userId);
    return reply.send({ data });
  });

  // POST /api/v1/admin/vip/members/:userId/cancel — Cancel VIP subscription (no refund)
  app.post("/members/:userId/cancel", { onRequest: [requirePermission("admin.vip.manage")] }, async (req, reply) => {
    const { userId }  = req.params as { userId: string };
    const adminId     = req.user.sub;
    const data = await adminCancelVipSubscription(userId, adminId);
    return reply.send({ data });
  });

  // POST /api/v1/admin/vip/members/:userId/reset-streak — Reset streak to 0
  app.post("/members/:userId/reset-streak", { onRequest: [requirePermission("admin.vip.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const adminId    = req.user.sub;
    const data = await adminResetVipStreak(userId, adminId);
    return reply.send({ data });
  });
}
