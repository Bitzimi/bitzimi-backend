import type { FastifyInstance } from "fastify";
import { db } from "../../db";
import { verifyFairness, decodeVerificationId } from "./provablyFair";
import { authenticate } from "../../middleware/authenticate";

function parsed(raw: string | null): any { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }

function claimedGameRoundResult(round: any): any {
  const r = parsed(round.resultData);
  if (round.gameType === "spin_battle") return { ...r, roundId: round.id };
  if (round.gameType === "color_game") return r.result ?? null;
  return r.result ?? r.winner ?? null;
}

async function gameRoundVerification(round: any) {
  if (!round.serverSeed || !round.serverSeedHash || !round.clientSeed || round.nonce === null) return null;
  return verifyFairness({ serverSeed: round.serverSeed, serverSeedHash: round.serverSeedHash, clientSeed: round.clientSeed, nonce: round.nonce, gameType: round.gameType, claimedResult: claimedGameRoundResult(round) });
}

async function diceRoundVerification(round: any) {
  if (!round.serverSeed || !round.serverSeedHash || !round.clientSeed || round.nonce === null) return null;
  const r = parsed(round.resultData);
  let playerIds: string[] = [];
  try { playerIds = JSON.parse(round.playerIds); } catch { playerIds = []; }
  return verifyFairness({ serverSeed: round.serverSeed, serverSeedHash: round.serverSeedHash, clientSeed: round.clientSeed, nonce: round.nonce, gameType: round.gameType, playerIds, claimedResult: { ...r, playerIds } });
}

async function pvpVerification(match: any) {
  if (!match.serverSeed || !match.serverSeedHash || !match.clientSeed || match.nonce === null) return null;
  const r = parsed(match.resultData);
  const claimedResult = match.gameType === "dice_clash" ? { p1Roll: r.p1Roll, p2Roll: r.p2Roll } : match.gameType === "pvp_coinflip" ? { coinFlip: r.coinFlip } : null;
  return verifyFairness({ serverSeed: match.serverSeed, serverSeedHash: match.serverSeedHash, clientSeed: match.clientSeed, nonce: match.nonce, gameType: match.gameType, claimedResult });
}

export async function provablyFairRoutes(app: FastifyInstance) {
  app.get("/lookup/:verificationId", async (req, reply) => {
    const { verificationId } = req.params as { verificationId: string };
    const decoded = decodeVerificationId(verificationId);
    if (!decoded) return reply.status(400).send({ error: "Invalid Verification ID format" });

    if (decoded.model === "game_round") {
      const round = await db.gameRound.findUnique({ where: { verificationId } });
      if (!round) return reply.status(404).send({ error: "Round not found" });
      const settled = !!round.settledAt;
      return reply.send({ ok: true, data: { verificationId: round.verificationId, gameType: round.gameType, lobbyId: round.lobbyId, roundNumber: round.roundNumber, dailyRoundNumber: round.dailyRoundNumber, displayDate: round.startedAt.toISOString().split("T")[0], status: round.status, settled, serverSeedHash: round.serverSeedHash, serverSeed: settled ? round.serverSeed : null, clientSeed: round.clientSeed, nonce: round.nonce, result: parsed(round.resultData), createdAt: round.startedAt.toISOString(), settledAt: round.settledAt?.toISOString() ?? null, verification: settled ? await gameRoundVerification(round) : null } });
    }

    if (decoded.model === "dice_round") {
      const round = await db.diceRound.findUnique({ where: { verificationId } });
      if (!round) return reply.status(404).send({ error: "Round not found" });
      const settled = !!round.settledAt;
      let playerIds: string[] = []; try { playerIds = JSON.parse(round.playerIds); } catch {}
      return reply.send({ ok: true, data: { verificationId: round.verificationId, gameType: round.gameType, roundNumber: round.roundNumber, stake: round.stake, status: round.status, playerIds, settled, serverSeedHash: round.serverSeedHash, serverSeed: settled ? round.serverSeed : null, clientSeed: round.clientSeed, nonce: round.nonce, result: parsed(round.resultData), createdAt: round.createdAt.toISOString(), settledAt: round.settledAt?.toISOString() ?? null, verification: settled ? await diceRoundVerification(round) : null } });
    }

    const match = await db.pvpMatch.findUnique({ where: { verificationId } });
    if (!match) return reply.status(404).send({ error: "Match not found" });
    const settled = !!match.serverSeed;
    return reply.send({ ok: true, data: { verificationId: match.verificationId, gameType: match.gameType, stake: match.stake, status: match.status, winnerId: match.winnerId, player1Id: match.player1Id, player2Id: match.player2Id, settled, serverSeedHash: match.serverSeedHash, serverSeed: settled ? match.serverSeed : null, clientSeed: match.clientSeed, nonce: match.nonce, result: parsed(match.resultData), createdAt: match.createdAt.toISOString(), settledAt: match.settledAt?.toISOString() ?? null, verification: settled ? await pvpVerification(match) : null } });
  });

  app.get("/round/:roundId", { preHandler: authenticate }, async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    const round = await db.gameRound.findUnique({ where: { id: roundId } });
    if (!round) return reply.status(404).send({ error: "Round not found" });
    const settled = !!round.settledAt;
    return reply.send({ ok: true, data: { roundId: round.id, verificationId: round.verificationId, gameType: round.gameType, lobbyId: round.lobbyId, roundNumber: round.roundNumber, dailyRoundNumber: round.dailyRoundNumber, status: round.status, settled, serverSeedHash: round.serverSeedHash, serverSeed: settled ? round.serverSeed : null, clientSeed: round.clientSeed, nonce: round.nonce, result: parsed(round.resultData), createdAt: round.startedAt.toISOString(), settledAt: round.settledAt?.toISOString() ?? null, verification: settled ? await gameRoundVerification(round) : null } });
  });

  app.get("/dice-round/:roundId", { preHandler: authenticate }, async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    const round = await db.diceRound.findUnique({ where: { id: roundId } });
    if (!round) return reply.status(404).send({ error: "Round not found" });
    const settled = !!round.settledAt;
    return reply.send({ ok: true, data: { roundId: round.id, verificationId: round.verificationId, gameType: round.gameType, roundNumber: round.roundNumber, stake: round.stake, status: round.status, playerIds: JSON.parse(round.playerIds), settled, serverSeedHash: round.serverSeedHash, serverSeed: settled ? round.serverSeed : null, clientSeed: round.clientSeed, nonce: round.nonce, result: parsed(round.resultData), createdAt: round.createdAt.toISOString(), settledAt: round.settledAt?.toISOString() ?? null, verification: settled ? await diceRoundVerification(round) : null } });
  });

  app.get("/match/:matchId", { preHandler: authenticate }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const userId = req.user.sub;
    const match = await db.pvpMatch.findFirst({ where: { id: matchId, OR: [{ player1Id: userId }, { player2Id: userId }] } });
    if (!match) return reply.status(404).send({ error: "Match not found" });
    const settled = !!match.serverSeed;
    return reply.send({ ok: true, data: { matchId: match.id, verificationId: match.verificationId, gameType: match.gameType, stake: match.stake, status: match.status, player1Id: match.player1Id, player2Id: match.player2Id, winnerId: match.winnerId, settled, serverSeedHash: match.serverSeedHash, serverSeed: settled ? match.serverSeed : null, clientSeed: match.clientSeed, nonce: match.nonce, result: parsed(match.resultData), createdAt: match.createdAt.toISOString(), settledAt: match.settledAt?.toISOString() ?? null, verification: settled ? await pvpVerification(match) : null } });
  });
}
