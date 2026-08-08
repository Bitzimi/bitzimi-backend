import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { getVipStatus, subscribeVIP, claimDailyStreak } from "./vip.service";

export async function vipRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/vip — subscription status + streak info
  app.get("/", async (req, reply) => {
    return reply.send({ data: await getVipStatus(req.user.sub) });
  });

  // POST /api/v1/vip/subscribe — subscribe ($4 deducted from main wallet)
  app.post("/subscribe", async (req, reply) => {
    return reply.status(201).send({ data: await subscribeVIP(req.user.sub) });
  });

  // POST /api/v1/vip/streak/claim — claim daily streak reward
  app.post("/streak/claim", async (req, reply) => {
    return reply.send({ data: await claimDailyStreak(req.user.sub) });
  });
}
