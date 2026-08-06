import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { adminListTasks, adminGetTaskDetail, adminApproveTask, adminRejectTask } from "./admin.tasks.service";

export async function adminTasksRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/tasks — list all tasks (must come before /:id)
  app.get("/", { onRequest: [requirePermission("admin.tasks.view")] }, async (req, reply) => {
    const q = z.object({ status: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    return reply.send({ data: await adminListTasks(q) });
  });

  // GET /api/v1/admin/tasks/:id — task detail with proofs and budget breakdown
  app.get("/:id", { onRequest: [requirePermission("admin.tasks.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await adminGetTaskDetail(id) });
  });

  // POST /api/v1/admin/tasks/:id/approve
  app.post("/:id/approve", { onRequest: [requirePermission("admin.tasks.approve")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await adminApproveTask(id, req.user.sub) });
  });

  // POST /api/v1/admin/tasks/:id/reject
  app.post("/:id/reject", { onRequest: [requirePermission("admin.tasks.reject")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    return reply.send({ data: await adminRejectTask(id, req.user.sub, body.reason) });
  });
}
