import { db } from "../../../db";
import { debitWallet, creditWallet } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { createReservedMatchForPlayers } from "./matchmaking.service";

const QUEUE_TTL_MS = 5 * 60_000;

export async function joinCoinFlipQueueIdempotent(userId: string, stake: number) {
  const gameType = "pvp_coinflip" as const;
  const now = new Date();
  const prepared = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:pvp_coinflip`}))`;
    const [enabled, maintenance, configuredStakes] = await Promise.all([
      getConfigValue<boolean>("game." + gameType + ".enabled", true),
      getConfigValue<boolean>("game." + gameType + ".maintenance", false),
      getConfigValue<number[]>("game." + gameType + ".stakes", []),
    ]);
    if (!enabled) throw Object.assign(new Error("pvp_coinflip is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
    if (maintenance) throw Object.assign(new Error("pvp_coinflip is under maintenance"), { statusCode: 503, code: "GAME_MAINTENANCE" });
    if (configuredStakes.length && !configuredStakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });

    const matchedQueues = await tx.matchmakingQueue.findMany({ where: { userId, gameType, status: "matched", matchId: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, matchId: true }, take: 10 });
    for (const q of matchedQueues) {
      const match = await tx.pvpMatch.findFirst({ where: { id: q.matchId!, gameType, OR: [{ player1Id: userId }, { player2Id: userId }] }, select: { status: true } });
      if (match?.status === "active") return { kind: "matched" as const, queueId: q.id, matchId: q.matchId! };
      await tx.matchmakingQueue.updateMany({ where: { id: q.id, status: "matched" }, data: { expiresAt: now } });
    }

    const activeMatch = await tx.pvpMatch.findFirst({ where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (activeMatch) {
      const activeQueue = await tx.matchmakingQueue.findFirst({ where: { userId, gameType, matchId: activeMatch.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
      return { kind: "matched" as const, queueId: activeQueue?.id ?? "", matchId: activeMatch.id };
    }

    const existing = await tx.matchmakingQueue.findFirst({ where: { userId, gameType, status: "reserved", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
    if (existing) {
      if (Number(existing.stake) !== Number(stake)) throw Object.assign(new Error(`You already have an active $${existing.stake} matchmaking search. Resume or cancel it before selecting another stake.`), { statusCode: 409, code: "ACTIVE_QUEUE_EXISTS" });
      return { kind: "waiting" as const, queueId: existing.id };
    }

    const opponent = await tx.matchmakingQueue.findFirst({ where: { gameType, stake, status: "reserved", userId: { not: userId }, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" } });
    if (!opponent) {
      await debitWallet(tx, userId, "game", stake);
      const entry = await tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
      return { kind: "waiting" as const, queueId: entry.id };
    }

    const claimed = await tx.matchmakingQueue.updateMany({ where: { id: opponent.id, status: "reserved", expiresAt: { gt: now } }, data: { status: "matched" } });
    if (!claimed.count) throw Object.assign(new Error("Opponent is no longer available. Please try again."), { statusCode: 409, code: "OPPONENT_UNAVAILABLE" });
    await debitWallet(tx, userId, "game", stake);
    const mine = await tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: "matched", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    return { kind: "create_match" as const, opponentId: opponent.userId, opponentQueueId: opponent.id, queueId: mine.id };
  });

  if (prepared.kind !== "create_match") return prepared;
  let match: Awaited<ReturnType<typeof createReservedMatchForPlayers>>;
  try {
    match = await createReservedMatchForPlayers(userId, prepared.opponentId, gameType, stake);
  } catch (err) {
    await db.$transaction(async tx => {
      await creditWallet(tx, userId, "game", stake);
      await tx.matchmakingQueue.deleteMany({ where: { id: prepared.queueId, status: "matched", matchId: null } });
      await tx.matchmakingQueue.updateMany({ where: { id: prepared.opponentQueueId, status: "matched", matchId: null }, data: { status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    }).catch(() => {});
    throw err;
  }

  try {
    await db.$transaction(async tx => {
      await tx.matchmakingQueue.update({ where: { id: prepared.opponentQueueId }, data: { matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
      await tx.matchmakingQueue.update({ where: { id: prepared.queueId }, data: { matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    });
  } catch (err) {
    // The match exists and both stakes are already committed. Never refund here:
    // doing so could create a funded match plus a second wallet credit. The
    // matched queues remain recoverable by the active-match lookup.
    console.error(`[CoinFlip] Queue finalization deferred for match ${match.id}:`, err);
    throw err;
  }
  return { status: "matched" as const, queueId: prepared.queueId, matchId: match.id };
}

export async function recoverCoinFlipQueue(userId: string, requestedStake: number) {
  void requestedStake;
  const now = new Date();
  const current = await db.matchmakingQueue.findFirst({ where: { userId, gameType: "pvp_coinflip", status: { in: ["reserved", "matched"] }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" }, select: { id: true, matchId: true, status: true, stake: true } });
  if (!current) return { status: "cancelled" as const };
  if (current.status === "reserved") return { status: "waiting" as const, queueId: current.id, stake: Number(current.stake) };
  if (!current.matchId) return { status: "cancelled" as const };
  const match = await db.pvpMatch.findFirst({ where: { id: current.matchId, gameType: "pvp_coinflip", OR: [{ player1Id: userId }, { player2Id: userId }] }, select: { id: true, stake: true, status: true } });
  if (!match || (match.status !== "active" && match.status !== "settled")) return { status: "cancelled" as const };
  return { status: "matched" as const, queueId: current.id, matchId: match.id, stake: Number(match.stake), matchStatus: match.status };
}

export async function getCoinFlipHistory(userId: string, stake?: number) {
  const feeRate = await getGameFeeRate("pvp_coinflip");
  const rows = await db.pvpMatch.findMany({ where: { gameType: "pvp_coinflip", status: "settled", ...(stake !== undefined ? { stake } : {}), OR: [{ player1Id: userId }, { player2Id: userId }] }, orderBy: { settledAt: "desc" }, take: 20, include: { player1: { include: { profile: { select: { username: true, avatarUrl: true } } } }, player2: { include: { profile: { select: { username: true, avatarUrl: true } } } } } });
  return rows.map(match => {
    const isPlayer1 = match.player1Id === userId;
    const opponent = isPlayer1 ? match.player2 : match.player1;
    const result = match.resultData ? JSON.parse(match.resultData) : null;
    const totalPool = Number(match.stake) * 2;
    const platformFee = totalPool * feeRate;
    const youWon = match.winnerId === userId;
    return { matchId: match.id, stake: Number(match.stake), totalPool, platformFee, result: result?.coinFlip ?? null, youWon, payout: youWon ? totalPool - platformFee : 0, opponent: { username: opponent.profile?.username ?? "Player", userId: opponent.id, avatar: opponent.profile?.avatarUrl ?? null }, createdAt: match.createdAt.toISOString(), settledAt: match.settledAt?.toISOString() ?? null };
  });
}
