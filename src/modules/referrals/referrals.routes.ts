import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { listReferrals, getReferralStats } from "./referrals.service";

export async function referralsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/referrals — direct (tier-1) referrals list
  app.get("/", async (req, reply) => {
    return reply.send({ data: await listReferrals(req.user.sub) });
  });

  // GET /api/v1/referrals/stats — totals and earnings
  app.get("/stats", async (req, reply) => {
    return reply.send({ data: await getReferralStats(req.user.sub) });
  });
}
