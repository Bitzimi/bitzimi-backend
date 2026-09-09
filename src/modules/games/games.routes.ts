import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { getGameStats, getGameHistory } from "./games.service";
import { getConfigValue, getGameFeeRate } from "../admin/config/admin.config.service";

export async function gamesSharedRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.get("/stats", async (req, reply) => {
    return reply.send({ data: await getGameStats(req.user.sub) });
  });

  app.get("/history", async (req, reply) => {
    const q = z.object({
      cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
      gameType: z.string().optional(), lobbyId: z.string().optional(),
    }).parse(req.query);
    return reply.send({ data: await getGameHistory(req.user.sub, q) });
  });

  // User-facing game configuration. The fee is read from the same authoritative
  // admin configuration used by settlement, so UI payout estimates can never
  // drift from the actual backend fee rate.
  app.get("/config/:gameType", async (req, reply) => {
    const { gameType } = z.object({ gameType: z.string().min(1).max(64) }).parse(req.params);
    const feeRate = await getGameFeeRate(gameType as any);
    const stakes = await getConfigValue<number[]>(`game.${gameType}.stakes`, []);
    return reply.send({ data: { gameType, feeRate, feePercent: feeRate * 100, stakes } });
  });
}
