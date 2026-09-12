import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { joinQueue, getQueueStatus, leaveQueue, getMatch, signalReady, submitTap, MatchGameType } from "./matchmaking.service";
import { joinCoinFlipQueueIdempotent, recoverCoinFlipQueue, getCoinFlipHistory } from "./coinflip-matchmaking.service";

const COIN_FLIP_OPPONENT_FOUND_MS = 10000;
const COIN_FLIP_SIDE_ASSIGNMENT_MS = 8000;
const COIN_FLIP_ANIMATION_MS = 5000;
const COIN_FLIP_RESULT_DISPLAY_MS = 4000;
const COIN_FLIP_RESULT_POPUP_MS = 12000;
const COIN_FLIP_SIDE_START_MS = COIN_FLIP_OPPONENT_FOUND_MS;
const COIN_FLIP_FLIP_START_MS = COIN_FLIP_SIDE_START_MS + COIN_FLIP_SIDE_ASSIGNMENT_MS;
const COIN_FLIP_RESULT_START_MS = COIN_FLIP_FLIP_START_MS + COIN_FLIP_ANIMATION_MS;
const COIN_FLIP_POPUP_START_MS = COIN_FLIP_RESULT_START_MS + COIN_FLIP_RESULT_DISPLAY_MS;
const COIN_FLIP_TOTAL_TIMELINE_MS = COIN_FLIP_POPUP_START_MS + COIN_FLIP_RESULT_POPUP_MS;

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
      const nowMs = Date.now();
      const createdMs = Date.parse(data.createdAt);
      const elapsedMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
      const opponentFoundEndsAt = new Date(createdMs + COIN_FLIP_OPPONENT_FOUND_MS).toISOString();
      const sideAssignmentEndsAt = new Date(createdMs + COIN_FLIP_FLIP_START_MS).toISOString();
      const animationStartAt = new Date(createdMs + COIN_FLIP_FLIP_START_MS).toISOString();
      const flipEndsAt = new Date(createdMs + COIN_FLIP_RESULT_START_MS).toISOString();
      const resultDisplayEndsAt = new Date(createdMs + COIN_FLIP_POPUP_START_MS).toISOString();
      const resultPopupEndsAt = new Date(createdMs + COIN_FLIP_TOTAL_TIMELINE_MS).toISOString();
      const phase = elapsedMs < COIN_FLIP_OPPONENT_FOUND_MS
        ? "matched"
        : elapsedMs < COIN_FLIP_FLIP_START_MS
          ? "side_assignment"
          : elapsedMs < COIN_FLIP_RESULT_START_MS
            ? "flipping"
            : elapsedMs < COIN_FLIP_POPUP_START_MS
              ? "result_display"
              : elapsedMs < COIN_FLIP_TOTAL_TIMELINE_MS
                ? "result_popup"
                : "finished";
      data.serverNow = new Date(nowMs).toISOString();
      data.phase = phase;
      data.opponentFoundEndsAt = opponentFoundEndsAt;
      data.sideAssignmentEndsAt = sideAssignmentEndsAt;
      data.animationStartAt = animationStartAt;
      data.flipEndsAt = flipEndsAt;
      data.resultDisplayEndsAt = resultDisplayEndsAt;
      data.resultPopupEndsAt = resultPopupEndsAt;
      data.opponentFoundDurationMs = COIN_FLIP_OPPONENT_FOUND_MS;
      data.sideAssignmentDurationMs = COIN_FLIP_SIDE_ASSIGNMENT_MS;
      data.animationDurationMs = COIN_FLIP_ANIMATION_MS;
      data.resultDisplayDurationMs = COIN_FLIP_RESULT_DISPLAY_MS;
      data.resultPopupDurationMs = COIN_FLIP_RESULT_POPUP_MS;
      data.totalTimelineMs = COIN_FLIP_TOTAL_TIMELINE_MS;
      data.timelineElapsedMs = Math.min(COIN_FLIP_TOTAL_TIMELINE_MS, elapsedMs);
      data.animationElapsedMs = Math.max(0, Math.min(COIN_FLIP_ANIMATION_MS, elapsedMs - COIN_FLIP_FLIP_START_MS));
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
    return reply.send({ data: await submitTap(req.user.sub, matchId, body.tapMs });
  });
}