import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { adminListTransactions } from "./admin.transactions.service";

export async function adminTransactionsRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/transactions
  app.get("/", { onRequest: [requirePermission("admin.financial.transactions.view")] }, async (req, reply) => {
    const q = z.object({
      type:   z.string().optional(),
      userId: z.string().optional(),
      cursor: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    return reply.send({ data: await adminListTransactions(q) });
  });
}
