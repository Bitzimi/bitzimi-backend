import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { adminListDeposits, adminConfirmDeposit } from "./admin.deposits.service";

export async function adminDepositsRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  app.get("/", { onRequest: [requirePermission("admin.financial.view")] }, async (req, reply) => {
    const q = z.object({ status: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    return reply.send({ data: await adminListDeposits(q) });
  });

  app.post("/:id/confirm", { onRequest: [requirePermission("admin.financial.confirm_deposits")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ txHash: z.string().optional() }).parse(req.body);
    return reply.send({ data: await adminConfirmDeposit(id, req.user.sub, body.txHash) });
  });
}
