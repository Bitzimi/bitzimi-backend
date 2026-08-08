/**
 * Provably Fair verification endpoints.
 *
 * Public: GET  /api/v1/games/fairness/lookup/:verificationId — lookup by Verification ID
 * Auth:   GET  /api/v1/games/fairness/round/:roundId          — GameRound  (Color, Spin)
 *         GET  /api/v1/games/fairness/dice-round/:roundId     — DiceRound  (Royale, Arena)
 *         GET  /api/v1/games/fairness/match/:matchId          — PvpMatch   (Clash, CoinFlip)
 */
import type { FastifyInstance } from "fastify";
import { db } from "../../db";
import { verifyFairness, decodeVerificationId } from "./provablyFair";
import { authenticate } from "../../middleware/authenticate";

export async function provablyFairRoutes(app: FastifyInstance) {
  // ── Lookup by Verification ID (public) ─────────────────────────────────────
  app.get("/lookup/:verificationId", async (req, reply) => {
    const { verificationId } = req.params as { verificationId: string };
    const decoded = decodeVerificationId(verificationId);
    if (!decoded) {
      return reply.status(400).send({ error: "Invalid Verification ID format" });
    }

    const { gameType, model } = decoded;

    if (model === "game_round") {
      const round = await db.gameRound.findUnique({
        where:  { verificationId },
        select: {
          id: true, gameType: true, lobbyId: true, roundNumber: true, dailyRoundNumber: true,
          status: true, serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
          resultData: true, startedAt: true, settledAt: true, verificationId: true,
        },
      });
      if (!round) return reply.status(404).send({ error: "Round not found" });

      const settled = !!round.settledAt;
      let verification: ReturnType<typeof verifyFairness> | null = null;
      if (settled && round.serverSeed && round.serverSeedHash && round.clientSeed && round.nonce !== null) {
        const parsed = round.resultData ? JSON.parse(round.resultData) : {};
        verification = verifyFairness({
          serverSeed:     round.serverSeed,
          serverSeedHash: round.serverSeedHash,
          clientSeed:     round.clientSeed,
          nonce:          round.nonce,
          gameType:       round.gameType,
          claimedResult:  parsed.result ?? parsed.winner ?? null,
        });
      }

      return reply.send({
        ok: true,
        data: {
          verificationId:   round.verificationId,
          gameType:         round.gameType,
          lobbyId:          round.lobbyId,
          roundNumber:      round.roundNumber,
          dailyRoundNumber: round.dailyRoundNumber,
          displayDate:      round.startedAt.toISOString().split("T")[0],
          status:           round.status,
          settled,
          serverSeedHash:   round.serverSeedHash,
          serverSeed:       settled ? round.serverSeed : null,
          clientSeed:       round.clientSeed,
          nonce:            round.nonce,
          result:           round.resultData ? JSON.parse(round.resultData) : null,
          createdAt:        round.startedAt.toISOString(),
          settledAt:        round.settledAt?.toISOString() ?? null,
          verification,
        },
      });
    }

    if (model === "dice_round") {
      const round = await db.diceRound.findUnique({
        where:  { verificationId },
        select: {
          id: true, gameType: true, roundNumber: true, stake: true,
          status: true, serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
          resultData: true, playerIds: true, createdAt: true, settledAt: true, verificationId: true,
        },
      });
      if (!round) return reply.status(404).send({ error: "Round not found" });

      const settled = !!round.settledAt;
      let verification: ReturnType<typeof verifyFairness> | null = null;
      if (settled && round.serverSeed && round.serverSeedHash && round.clientSeed && round.nonce !== null) {
        verification = verifyFairness({
          serverSeed:     round.serverSeed,
          serverSeedHash: round.serverSeedHash,
          clientSeed:     round.clientSeed,
          nonce:          round.nonce,
          gameType:       round.gameType,
        });
      }

      return reply.send({
        ok: true,
        data: {
          verificationId:  round.verificationId,
          gameType:        round.gameType,
          roundNumber:     round.roundNumber,
          stake:           round.stake,
          status:          round.status,
          settled,
          serverSeedHash:  round.serverSeedHash,
          serverSeed:      settled ? round.serverSeed : null,
          clientSeed:      round.clientSeed,
          nonce:           round.nonce,
          result:          round.resultData ? JSON.parse(round.resultData) : null,
          createdAt:       round.createdAt.toISOString(),
          settledAt:       round.settledAt?.toISOString() ?? null,
          verification,
        },
      });
    }

    if (model === "pvp_match") {
      const match = await db.pvpMatch.findUnique({
        where:  { verificationId },
        select: {
          id: true, gameType: true, stake: true, status: true,
          player1Id: true, player2Id: true, winnerId: true,
          serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
          resultData: true, createdAt: true, settledAt: true, verificationId: true,
        },
      });
      if (!match) return reply.status(404).send({ error: "Match not found" });

      const settled = !!match.serverSeed;
      let verification: ReturnType<typeof verifyFairness> | null = null;
      if (settled && match.serverSeed && match.serverSeedHash && match.clientSeed && match.nonce !== null) {
        const parsed = match.resultData ? JSON.parse(match.resultData) : {};
        verification = verifyFairness({
          serverSeed:     match.serverSeed,
          serverSeedHash: match.serverSeedHash,
          clientSeed:     match.clientSeed,
          nonce:          match.nonce,
          gameType:       match.gameType,
          claimedResult:  match.gameType === "dice_clash"
            ? { p1Roll: parsed.p1Roll, p2Roll: parsed.p2Roll }
            : match.gameType === "pvp_coinflip"
            ? { coinFlip: parsed.coinFlip }
            : null,
        });
      }

      return reply.send({
        ok: true,
        data: {
          verificationId:  match.verificationId,
          gameType:        match.gameType,
          stake:           match.stake,
          status:          match.status,
          winnerId:        match.winnerId,
          settled,
          serverSeedHash:  match.serverSeedHash,
          serverSeed:      settled ? match.serverSeed : null,
          clientSeed:      match.clientSeed,
          nonce:           match.nonce,
          result:          match.resultData ? JSON.parse(match.resultData) : null,
          createdAt:       match.createdAt.toISOString(),
          settledAt:       match.settledAt?.toISOString() ?? null,
          verification,
        },
      });
    }

    return reply.status(400).send({ error: "Unrecognised verification ID" });
  });

  // ── GameRound fairness data (Color Prediction / Spin Battle) ─────────────────
  app.get("/round/:roundId", { preHandler: authenticate }, async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    const round = await db.gameRound.findUnique({
      where:  { id: roundId },
      select: {
        id: true, gameType: true, lobbyId: true, roundNumber: true, dailyRoundNumber: true,
        status: true, serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
        resultData: true, startedAt: true, settledAt: true, verificationId: true,
      },
    });
    if (!round) return reply.status(404).send({ error: "Round not found" });

    const settled = !!round.settledAt;
    let verification: ReturnType<typeof verifyFairness> | null = null;
    if (settled && round.serverSeed && round.serverSeedHash && round.clientSeed && round.nonce !== null) {
      const parsed = round.resultData ? JSON.parse(round.resultData) : {};
      verification = verifyFairness({
        serverSeed:     round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed:     round.clientSeed,
        nonce:          round.nonce,
        gameType:       round.gameType,
        claimedResult:  parsed.result ?? parsed.winner ?? null,
      });
    }

    return reply.send({
      ok: true,
      data: {
        roundId:          round.id,
        verificationId:   round.verificationId,
        gameType:         round.gameType,
        lobbyId:          round.lobbyId,
        roundNumber:      round.roundNumber,
        dailyRoundNumber: round.dailyRoundNumber,
        status:           round.status,
        settled,
        serverSeedHash:   round.serverSeedHash,
        serverSeed:       settled ? round.serverSeed : null,
        clientSeed:       round.clientSeed,
        nonce:            round.nonce,
        result:           round.resultData ? JSON.parse(round.resultData) : null,
        createdAt:        round.startedAt.toISOString(),
        settledAt:        round.settledAt?.toISOString() ?? null,
        verification,
      },
    });
  });

  // ── DiceRound fairness data (Dice Royale / Dice Arena) ───────────────────────
  app.get("/dice-round/:roundId", { preHandler: authenticate }, async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    const round = await db.diceRound.findUnique({
      where:  { id: roundId },
      select: {
        id: true, gameType: true, roundNumber: true, stake: true,
        status: true, serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
        resultData: true, playerIds: true, createdAt: true, settledAt: true, verificationId: true,
      },
    });
    if (!round) return reply.status(404).send({ error: "Round not found" });

    const settled = !!round.settledAt;
    let verification: ReturnType<typeof verifyFairness> | null = null;
    if (settled && round.serverSeed && round.serverSeedHash && round.clientSeed && round.nonce !== null) {
      verification = verifyFairness({
        serverSeed:     round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed:     round.clientSeed,
        nonce:          round.nonce,
        gameType:       round.gameType,
      });
    }

    return reply.send({
      ok: true,
      data: {
        roundId:        round.id,
        verificationId: round.verificationId,
        gameType:       round.gameType,
        roundNumber:    round.roundNumber,
        stake:          round.stake,
        status:         round.status,
        playerIds:      JSON.parse(round.playerIds),
        settled,
        serverSeedHash: round.serverSeedHash,
        serverSeed:     settled ? round.serverSeed : null,
        clientSeed:     round.clientSeed,
        nonce:          round.nonce,
        result:         round.resultData ? JSON.parse(round.resultData) : null,
        createdAt:      round.createdAt.toISOString(),
        settledAt:      round.settledAt?.toISOString() ?? null,
        verification,
      },
    });
  });

  // ── PvpMatch fairness data (Dice Clash / Coin Flip) ──────────────────────────
  app.get("/match/:matchId", { preHandler: authenticate }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const userId = req.user?.sub;

    const match = await db.pvpMatch.findFirst({
      where:  { id: matchId, OR: [{ player1Id: userId }, { player2Id: userId }] },
      select: {
        id: true, gameType: true, stake: true, status: true,
        player1Id: true, player2Id: true, winnerId: true,
        serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
        resultData: true, createdAt: true, settledAt: true, verificationId: true,
      },
    });
    if (!match) return reply.status(404).send({ error: "Match not found" });

    const settled = !!match.serverSeed;
    let verification: ReturnType<typeof verifyFairness> | null = null;
    if (settled && match.serverSeed && match.serverSeedHash && match.clientSeed && match.nonce !== null) {
      const parsed = match.resultData ? JSON.parse(match.resultData) : {};
      verification = verifyFairness({
        serverSeed:     match.serverSeed,
        serverSeedHash: match.serverSeedHash,
        clientSeed:     match.clientSeed,
        nonce:          match.nonce,
        gameType:       match.gameType,
        claimedResult:  match.gameType === "dice_clash"
          ? { p1Roll: parsed.p1Roll, p2Roll: parsed.p2Roll }
          : match.gameType === "pvp_coinflip"
          ? { coinFlip: parsed.coinFlip }
          : null,
      });
    }

    return reply.send({
      ok: true,
      data: {
        matchId:        match.id,
        verificationId: match.verificationId,
        gameType:       match.gameType,
        stake:          match.stake,
        status:         match.status,
        player1Id:      match.player1Id,
        player2Id:      match.player2Id,
        winnerId:       match.winnerId,
        settled,
        serverSeedHash: match.serverSeedHash,
        serverSeed:     settled ? match.serverSeed : null,
        clientSeed:     match.clientSeed,
        nonce:          match.nonce,
        result:         match.resultData ? JSON.parse(match.resultData) : null,
        createdAt:      match.createdAt.toISOString(),
        settledAt:      match.settledAt?.toISOString() ?? null,
        verification,
      },
    });
  });
}
