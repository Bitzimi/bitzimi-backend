import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { getGameStats, getGameHistory } from "./games.service";

export async function gamesSharedRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/games/stats — all-time stats across all game types
  app.get("/stats", async (req, reply) => {
    return reply.send({ data: await getGameStats(req.user.sub) });
  });

  // GET /api/v1/games/history — paginated bet history
  app.get("/history", async (req, reply) => {
    const q = z.object({
      cursor:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(50).default(20),
      gameType: z.string().optional(),
    }).parse(req.query);
    return reply.send({ data: await getGameHistory(req.user.sub, q) });
  });
}
