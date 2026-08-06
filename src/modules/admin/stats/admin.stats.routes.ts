import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { getAdminStats, getAuditLog, getRecentActivity, getHealthStatus } from "./admin.stats.service";

export async function adminStatsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/stats — full platform KPI aggregation
  app.get("/", { onRequest: [requirePermission("admin.dashboard.view")] }, async (_req, reply) => {
    return reply.send({ data: await getAdminStats() });
  });

  // GET /api/v1/admin/stats/activity — recent platform activity feed
  app.get("/activity", { onRequest: [requirePermission("admin.dashboard.view")] }, async (req, reply) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) }).parse(req.query);
    return reply.send({ data: await getRecentActivity(q.limit) });
  });

  // GET /api/v1/admin/stats/health — system health status
  app.get("/health", { onRequest: [requirePermission("admin.dashboard.view")] }, async (_req, reply) => {
    return reply.send({ data: await getHealthStatus() });
  });

  // GET /api/v1/admin/audit  (audit log — paginated history)
  app.get("/audit", { onRequest: [requirePermission("admin.audit.view")] }, async (req, reply) => {
    const q = z.object({
      cursor:     z.string().optional(),
      limit:      z.coerce.number().int().min(1).max(100).default(50),
      actorId:    z.string().optional(),
      targetType: z.string().optional(),
    }).parse(req.query);
    return reply.send({ data: await getAuditLog(q) });
  });
}
