import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminListReferrals,
  adminGetReferralStats,
  adminListReferralTransactions,
  adminGetReferralDetail,
} from "./admin.referrals.service";

export async function adminReferralsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/referrals — paginated list of all referrals
  app.get("/", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({
      search:   z.string().optional(),
      rewarded: z.enum(["true", "false"]).transform(v => v === "true").optional(),
      cursor:   z.string().optional(),
      limit:    z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListReferrals(query);
    return reply.send({ data });
  });

  // GET /api/v1/admin/referrals/stats — platform-wide referral statistics
  app.get("/stats", { onRequest: [requirePermission("admin.referrals.view")] }, async (_req, reply) => {
    const data = await adminGetReferralStats();
    return reply.send({ data });
  });

  // GET /api/v1/admin/referrals/transactions — all referral bonus transactions
  app.get("/transactions", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListReferralTransactions(query);
    return reply.send({ data });
  });

  // GET /api/v1/admin/referrals/:id — referral detail
  app.get("/:id", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await adminGetReferralDetail(id);
    return reply.send({ data });
  });
}
