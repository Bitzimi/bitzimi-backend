import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { joinQueue, getQueueStatus, leaveQueue, getMatch, signalReady, submitTap, MatchGameType } from "./matchmaking.service";

const VALID_GAME_TYPES: MatchGameType[] = ["dice_clash", "pvp_coinflip", "reaction_tap"];

export async function matchmakingRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // POST /api/v1/games/queue — join matchmaking queue
  app.post("/queue", async (req, reply) => {
    const body = z.object({
      gameType: z.enum(["dice_clash", "pvp_coinflip", "reaction_tap"]),
      stake:    z.number().positive(),
    }).parse(req.body);
    const data = await joinQueue(req.user.sub, body.gameType, body.stake);
    return reply.status(data.status === "matched" ? 200 : 202).send({ data });
  });

  // GET /api/v1/games/queue/:queueId — poll queue status
  app.get("/queue/:queueId", async (req, reply) => {
    const { queueId } = req.params as { queueId: string };
    return reply.send({ data: await getQueueStatus(req.user.sub, queueId) });
  });

  // DELETE /api/v1/games/queue/:queueId — leave queue
  app.delete("/queue/:queueId", async (req, reply) => {
    const { queueId } = req.params as { queueId: string };
    await leaveQueue(req.user.sub, queueId);
    return reply.status(204).send();
  });

  // GET /api/v1/games/matches/:matchId — get match state and result
  app.get("/matches/:matchId", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    return reply.send({ data: await getMatch(req.user.sub, matchId) });
  });

  // POST /api/v1/games/matches/:matchId/ready — ReactionTap: signal ready
  app.post("/matches/:matchId/ready", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    return reply.send({ data: await signalReady(req.user.sub, matchId) });
  });

  // POST /api/v1/games/matches/:matchId/tap — ReactionTap: submit tap time
  app.post("/matches/:matchId/tap", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const body = z.object({ tapMs: z.number().int() }).parse(req.body);
    return reply.send({ data: await submitTap(req.user.sub, matchId, body.tapMs) });
  });
}
