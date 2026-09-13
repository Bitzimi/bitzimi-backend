import { generateServerSeed, hashServerSeed, generateClientSeed, deriveCoinFlip, generateVerificationId } from "../provablyFair";
import { db } from "../../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { recordGameResult } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";

const QUEUE_TTL_MS = 5 * 60 * 1000;

export async function joinCoinFlipQueue(userId: string, stake: number) {
  const activeMatch = await db.pvpMatch.findFirst({ where: { gameType: "pvp_coinflip", status: { in: ["active", "settling"] }, OR: [{ player1Id: userId }, { player2Id: userId }] } });
  if (activeMatch) {
    const entry = await db.matchmakingQueue.findFirst({ where: { userId, gameType: "pvp_coinflip", matchId: activeMatch.id } });
    return { status: "matched" as const, queueId: entry?.id ?? "", matchId: activeMatch.id };
  }
  const existing = await db.matchmakingQueue.findFirst({ where: { userId, gameType: "pvp_coinflip", stake, status: "waiting" } });
  if (existing) return { status: "waiting" as const, queueId: existing.id };
  const [enabled, maintenance, configuredStakes] = await Promise.all([
    getConfigValue<boolean>("game.pvp_coinflip.enabled", true),
    getConfigValue<boolean>("game.pvp_coinflip.maintenance", false),
    getConfigValue<number[]>("game.pvp_coinflip.stakes", []),
  ]);
  if (!enabled) throw Object.assign(new Error("pvp_coinflip is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (maintenance) throw Object.assign(new Error("pvp_coinflip is currently unavailable"), { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (configuredStakes.length > 0 && !configuredStakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });
  const opponent = await db.matchmakingQueue.findFirst({ where: { gameType: "pvp_coinflip", stake, status: "waiting", userId: { not: userId }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } });
  if (!opponent) {
    const entry = await db.matchmakingQueue.create({ data: { userId, gameType: "pvp_coinflip", stake, status: "waiting", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    return { status: "waiting" as const, queueId: entry.id };
  }
  const claimed = await db.matchmakingQueue.updateMany({ where: { id: opponent.id, status: "waiting" }, data: { status: "matched" } });
  if (!claimed.count) {
    const entry = await db.matchmakingQueue.create({ data: { userId, gameType: "pvp_coinflip", stake, status: "waiting", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    return { status: "waiting" as const, queueId: entry.id };
  }
  const match = await createCoinFlipMatchForPlayers(userId, opponent.userId, stake);
  await db.matchmakingQueue.update({ where: { id: opponent.id }, data: { matchId: match.id } });
  const myQueue = await db.matchmakingQueue.create({ data: { userId, gameType: "pvp_coinflip", stake, status: "matched", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
  return { status: "matched" as const, queueId: myQueue.id, matchId: match.id };
}

export async function createCoinFlipMatchForPlayers(player1Id: string, player2Id: string, stake: number) {
  const totalPool = stake * 2;
  const feeRate = await getGameFeeRate("pvp_coinflip");
  const fee = totalPool * feeRate;

  await db.$transaction(async tx => {
    for (const pid of [player1Id, player2Id]) {
      await debitWallet(tx, pid, "game", stake);
      await writeLedgerEntry(tx, { userId: pid, type: "game_bet", fromWallet: "game", amount: stake, description: "pvp_coinflip match entry", referenceType: "pvp_match", metadata: { gameType: "pvp_coinflip", stake } });
    }
  });

  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const verificationId = generateVerificationId("pvp_coinflip");
  const match = await db.pvpMatch.create({ data: { gameType: "pvp_coinflip", stake, player1Id, player2Id, serverSeedHash, verificationId } });

  // Assignment version 2 deliberately normalizes participant order by stable user ID.
  // Home/Away and Heads/Tails are separate deterministic draws and neither depends
  // on which participant triggered the matchmaking request first.
  const sortedPlayerIds = [player1Id, player2Id].sort();
  const clientSeed = generateClientSeed(...sortedPlayerIds, match.id);
  const homeIsFirstSortedPlayer = deriveCoinFlip(serverSeed, clientSeed, 2) === "heads";
  const homePlayerId = homeIsFirstSortedPlayer ? sortedPlayerIds[0] : sortedPlayerIds[1];
  const awayPlayerId = homePlayerId === sortedPlayerIds[0] ? sortedPlayerIds[1] : sortedPlayerIds[0];

  const firstSortedPlayerSide = deriveCoinFlip(serverSeed, clientSeed, 3);
  const sideByUserId: Record<string, "heads" | "tails"> = {
    [sortedPlayerIds[0]]: firstSortedPlayerSide,
    [sortedPlayerIds[1]]: firstSortedPlayerSide === "heads" ? "tails" : "heads",
  };
  const p1Side = sideByUserId[player1Id];
  const p2Side = sideByUserId[player2Id];
  const coinFlip = deriveCoinFlip(serverSeed, clientSeed, 1);
  const winnerId = coinFlip === sideByUserId[player1Id] ? player1Id : player2Id;

  const resultData = JSON.stringify({ assignmentVersion: 2, homePlayerId, awayPlayerId, p1Side, p2Side, coinFlip, winnerId });
  return db.pvpMatch.update({ where: { id: match.id }, data: { resultData, clientSeed, nonce: 1, serverSeed } });
}

export async function getCoinFlipMatch(userId: string, matchId: string) {
  const match = await db.pvpMatch.findFirst({ where: { id: matchId, gameType: "pvp_coinflip", OR: [{ player1Id: userId }, { player2Id: userId }] }, include: { player1: { include: { profile: { select: { username: true, avatarUrl: true } } } }, player2: { include: { profile: { select: { username: true, avatarUrl: true } } } } } });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404, code: "NOT_FOUND" });
  const isPlayer1 = match.player1Id === userId;
  const opponent = isPlayer1 ? match.player2 : match.player1;
  const resultData = match.resultData ? JSON.parse(match.resultData) : null;
  const totalPool = match.stake * 2;
  const feeRate = await getGameFeeRate("pvp_coinflip");
  const fee = totalPool * feeRate;
  const opponentUsername = opponent.profile?.username ?? "Player";
  const opponentAvatar = opponent.profile?.avatarUrl ?? (opponentUsername.charAt(0).toUpperCase() || "?");
  return { matchId: match.id, gameType: match.gameType, stake: match.stake, totalPool, platformFee: fee, status: match.status, isPlayer1, playerIsHome: resultData?.homePlayerId === userId, opponent: { username: opponentUsername, userId: opponent.id, avatar: opponentAvatar }, result: resultData, winnerId: match.winnerId ?? resultData?.winnerId ?? null, youWon: (match.winnerId ?? resultData?.winnerId) === userId, payout: totalPool - fee, verificationId: match.verificationId, createdAt: match.createdAt.toISOString(), settledAt: match.settledAt?.toISOString() ?? null, signalSentAt: null, yourReady: false, opponentReady: false };
}

export async function settleCoinFlip(userId: string, matchId: string) {
  const match = await db.pvpMatch.findFirst({ where: { id: matchId, gameType: "pvp_coinflip", OR: [{ player1Id: userId }, { player2Id: userId }] } });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (match.status === "settled") {
    const resultData = match.resultData ? JSON.parse(match.resultData) : {};
    const feeRate = await getGameFeeRate("pvp_coinflip");
    return { settled: true, winnerId: resultData.winnerId ?? match.winnerId, payout: match.stake * 2 - match.stake * 2 * feeRate };
  }
  if (match.status === "settling") throw Object.assign(new Error("Coin Flip settlement is still in progress"), { statusCode: 409, code: "SETTLEMENT_IN_PROGRESS" });
  if (match.status !== "active") throw Object.assign(new Error("Coin Flip match is not ready for settlement"), { statusCode: 409, code: "MATCH_NOT_SETTLEABLE" });
  const resultData = match.resultData ? JSON.parse(match.resultData) : null;
  if (!resultData?.winnerId || !resultData?.coinFlip || !resultData?.p1Side || !resultData?.p2Side) throw Object.assign(new Error("Coin Flip result is not ready"), { statusCode: 409, code: "RESULT_NOT_READY" });
  const feeRate = await getGameFeeRate("pvp_coinflip");
  const totalPool = match.stake * 2;
  const payout = totalPool - totalPool * feeRate;
  const winnerId = resultData.winnerId as string;
  const loserId = winnerId === match.player1Id ? match.player2Id : match.player1Id;
  const clientSeed = match.clientSeed ?? generateClientSeed(...[match.player1Id, match.player2Id].sort(), match.id);
  const outcome = await db.$transaction(async tx => {
    const claimed = await tx.pvpMatch.updateMany({ where: { id: matchId, status: "active" }, data: { status: "settling" } });
    if (!claimed.count) return null;
    await creditWallet(tx, winnerId, "game", payout);
    await writeLedgerEntry(tx, { userId: winnerId, type: "game_win", toWallet: "game", amount: payout, description: "Coin flip win", referenceId: matchId, referenceType: "pvp_match" });
    await tx.pvpMatch.update({ where: { id: matchId }, data: { status: "settled", winnerId, settledAt: new Date(), clientSeed, nonce: 1 } });
    await recordGameResult({ tx, userId: winnerId, gameType: "pvp_coinflip", wagered: match.stake, won: true, payout });
    await recordGameResult({ tx, userId: loserId, gameType: "pvp_coinflip", wagered: match.stake, won: false, payout: 0 });
    const userFee = match.stake * feeRate;
    await createGameFeeJobInTx(tx, { userId: winnerId, userFee, isMultiGame: false, eventRefId: matchId });
    await createGameFeeJobInTx(tx, { userId: loserId, userFee, isMultiGame: false, eventRefId: matchId });
    return { settled: true, winnerId, payout };
  });
  if (outcome) return outcome;
  const current = await db.pvpMatch.findUnique({ where: { id: matchId } });
  if (current?.status === "settled") return { settled: true, winnerId: current.winnerId, payout };
  throw Object.assign(new Error("Coin Flip settlement is still in progress"), { statusCode: 409, code: "SETTLEMENT_IN_PROGRESS" });
}
