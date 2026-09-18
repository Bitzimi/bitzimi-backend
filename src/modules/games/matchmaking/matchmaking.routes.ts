import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { joinQueue, getQueueStatus, leaveQueue, getMatch, signalReady, submitTap, MatchGameType } from "./matchmaking.service";
import { joinCoinFlipQueue, getCoinFlipMatch, settleCoinFlip } from "./coinFlipMatchmaking.service";

const VALID_GAME_TYPES: MatchGameType[] = ["dice_clash", "pvp_coinflip", "reaction_tap"];

export async function matchmakingRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.post("/queue", async (req, reply) => {
    const body = z.object({ gameType: z.enum(["dice_clash", "pvp_coinflip", "reaction_tap"]), stake: z.number().positive() }).parse(req.body);
    const data = body.gameType === "pvp_coinflip" ? await joinCoinFlipQueue(req.user.sub, body.stake) : await joinQueue(req.user.sub, body.gameType, body.stake);
    return reply.status(data.status === "matched" ? 200 : 202).send({ data });
  });

  app.get("/queue/:queueId", async (req, reply) => {
    const { queueId } = req.params as { queueId: string };
    return reply.send({ data: await getQueueStatus(req.user.sub, queueId) });
  });

  app.delete("/queue/:queueId", async (req, reply) => {
    const { queueId } = req.params as { queueId: string };
    await leaveQueue(req.user.sub, queueId);
    return reply.status(204).send();
  });

  app.get("/matches/:matchId", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const data = await getCoinFlipMatch(req.user.sub, matchId).catch(async err => {
      if ((err as any)?.statusCode !== 404) throw err;
      return getMatch(req.user.sub, matchId);
    });
    // Reaction Tap needs the same read-only winner amount that Coin Flip exposes.
    // This is derived server-side from the authoritative pool and configured fee;
    // no game outcome or settlement logic is changed here.
    const responseData = data.gameType === "reaction_tap"
      ? { ...data, winnerPayout: data.totalPool - data.platformFee }
      : data;
    return reply.send({ data: responseData });
  });

  app.post("/matches/:matchId/settle", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    return reply.send({ data: await settleCoinFlip(req.user.sub, matchId) });
  });

  app.post("/matches/:matchId/ready", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    return reply.send({ data: await signalReady(req.user.sub, matchId) });
  });

  app.post("/matches/:matchId/tap", async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const body = z.object({ tapMs: z.number().int() }).parse(req.body);
    return reply.send({ data: await submitTap(req.user.sub, matchId, body.tapMs) });
  });
}