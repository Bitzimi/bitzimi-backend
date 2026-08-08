import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  adminListWithdrawals,
  adminGetWithdrawal,
  adminProcessWithdrawal,
  adminCompleteWithdrawal,
  adminRejectWithdrawal,
} from "./admin.withdrawals.service";

export async function adminWithdrawalsRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/withdrawals
  app.get("/", { onRequest: [requirePermission("admin.financial.view")] }, async (req, reply) => {
    const q = z.object({
      status: z.string().optional(),
      cursor: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    return reply.send({ data: await adminListWithdrawals(q) });
  });

  // GET /api/v1/admin/withdrawals/:id
  app.get("/:id", { onRequest: [requirePermission("admin.financial.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await adminGetWithdrawal(id) });
  });

  // POST /api/v1/admin/withdrawals/:id/process
  app.post("/:id/process", { onRequest: [requirePermission("admin.financial.process_withdrawals")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await adminProcessWithdrawal(id, req.user.sub) });
  });

  // POST /api/v1/admin/withdrawals/:id/complete
  app.post("/:id/complete", { onRequest: [requirePermission("admin.financial.process_withdrawals")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ txHash: z.string().optional() }).parse(req.body ?? {});
    return reply.send({ data: await adminCompleteWithdrawal(id, req.user.sub, body.txHash) });
  });

  // POST /api/v1/admin/withdrawals/:id/reject
  app.post("/:id/reject", { onRequest: [requirePermission("admin.financial.process_withdrawals")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    return reply.send({ data: await adminRejectWithdrawal(id, req.user.sub, body.reason) });
  });
}
