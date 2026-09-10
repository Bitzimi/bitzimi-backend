import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { joinQueue, getQueueStatus, leaveQueue, getMatch, signalReady, submitTap, MatchGameType } from "./matchmaking.service";
import { joinCoinFlipQueueIdempotent, recoverCoinFlipQueue, getCoinFlipHistory } from "./coinflip-matchmaking.service";

const COIN_FLIP_DURATION_MS = 8000;

export async function matchmakingRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.post("/queue", async (req, reply) => {
    const body = z.object({ gameType: z.enum(["dice_clash", "pvp_coinflip", "reaction_tap"]), stake: z.number().positive() }).parse(req.body);
    const raw = body.gameType === "pvp_coinflip"
      ? await joinCoinFlipQueueIdempotent(req.user.sub, body.stake)
      : await joinQueue(req.user.sub, body.gameType, body.stake);
    const data = "status" in raw
      ? raw
      : raw.kind === "matched"
        ? { status: "matched" as const, queueId: raw.queueId, matchId: raw.matchId }
        : { status: "waiting" as const, queueId: raw.queueId };
    return reply.status(data.status === "matched" ? 200 : 202).send({ data });
  });

  app.get("/queue/recover", async (req, reply) => {
    const query = z.object({ gameType: z.literal("pvp_coinflip"), stake: z.coerce.number().positive() }).parse(req.query);
    return reply.send({ data: await recoverCoinFlipQueue(req.user.sub, query.stake) });
  });

  app.get("/coinflip/history", async (req, reply) => {
    const query = z.object({ stake: z.coerce.number().positive().optional() }).parse(req.query);
    return reply.send({ data: await getCoinFlipHistory(req.user.sub, query.stake) });
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
    const data: any = await getMatch(req.user.sub, matchId);
    if (data.gameType === "pvp_coinflip") {
      data.serverNow = new Date().toISOString();
      data.animationStartAt = data.createdAt;
      data.animationDurationMs = COIN_FLIP_DURATION_MS;
    }
    return reply.send({ data });
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
