import { db } from "../../../db";
import { debitWallet, creditWallet } from "../../wallets/wallets.service";
import { getConfigValue } from "../../admin/config/admin.config.service";
import { createReservedMatchForPlayers } from "./matchmaking.service";

const QUEUE_TTL_MS = 5 * 60_000;

/** Coin Flip is a paid queue: repeated/retried enqueue requests must be idempotent. */
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

    const activeMatch = await tx.pvpMatch.findFirst({
      where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, stake: true },
    });
    if (activeMatch) {
      const activeQueue = await tx.matchmakingQueue.findFirst({
        where: { userId, gameType, matchId: activeMatch.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      return { kind: "matched" as const, queueId: activeQueue?.id ?? "", matchId: activeMatch.id };
    }

    const existing = await tx.matchmakingQueue.findFirst({
      where: { userId, gameType, status: "reserved", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      if (Number(existing.stake) !== Number(stake)) throw Object.assign(new Error(`You already have an active $${existing.stake} matchmaking search. Resume or cancel it before selecting another stake.`), { statusCode: 409, code: "ACTIVE_QUEUE_EXISTS" });
      return { kind: "waiting" as const, queueId: existing.id };
    }

    const opponent = await tx.matchmakingQueue.findFirst({
      where: { gameType, stake, status: "reserved", userId: { not: userId }, expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
    });

    if (!opponent) {
      await debitWallet(tx, userId, "game", stake);
      const entry = await tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
      return { kind: "waiting" as const, queueId: entry.id };
    }

    const claimed = await tx.matchmakingQueue.updateMany({
      where: { id: opponent.id, status: "reserved", expiresAt: { gt: now } },
      data: { status: "matched" },
    });
    if (!claimed.count) throw Object.assign(new Error("Opponent is no longer available. Please try again."), { statusCode: 409, code: "OPPONENT_UNAVAILABLE" });

    await debitWallet(tx, userId, "game", stake);
    return { kind: "create_match" as const, opponentId: opponent.userId, opponentQueueId: opponent.id };
  });

  if (prepared.kind !== "create_match") return prepared;

  let match: Awaited<ReturnType<typeof createReservedMatchForPlayers>>;
  try {
    match = await createReservedMatchForPlayers(userId, prepared.opponentId, gameType, stake);
  } catch (err) {
    await db.$transaction(async tx => {
      await creditWallet(tx, userId, "game", stake);
      await creditWallet(tx, prepared.opponentId, "game", stake);
      await tx.matchmakingQueue.updateMany({ where: { id: prepared.opponentQueueId, status: "matched", matchId: null }, data: { status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    }).catch(() => {});
    throw err;
  }

  await db.$transaction(async tx => {
    await tx.matchmakingQueue.update({ where: { id: prepared.opponentQueueId }, data: { matchId: match.id } });
    await tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: "matched", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
  });

  const mine = await db.matchmakingQueue.findFirstOrThrow({
    where: { userId, gameType, matchId: match.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return { status: "matched" as const, queueId: mine.id, matchId: match.id };
}

/** Read-only recovery: it can never create a queue or debit a wallet. */
export async function recoverCoinFlipQueue(userId: string, requestedStake: number) {
  void requestedStake;
  const now = new Date();

  // A matched queue entry is the durable recovery pointer. It remains valid for
  // the paid queue lease even after the match has already settled, which lets a
  // browser reload into the current match/result instead of creating a new paid
  // search after the original match has already been found.
  const matchedQueue = await db.matchmakingQueue.findFirst({
    where: { userId, gameType: "pvp_coinflip", status: "matched", expiresAt: { gt: now }, matchId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, matchId: true, stake: true },
  });
  if (matchedQueue?.matchId) {
    const match = await db.pvpMatch.findFirst({ where: { id: matchedQueue.matchId, gameType: "pvp_coinflip", OR: [{ player1Id: userId }, { player2Id: userId }] }, select: { id: true, stake: true, status: true } });
    if (match && (match.status === "active" || match.status === "settled")) {
      return { status: "matched" as const, queueId: matchedQueue.id, matchId: match.id, stake: Number(match.stake) };
    }
  }

  const entry = await db.matchmakingQueue.findFirst({
    where: { userId, gameType: "pvp_coinflip", status: "reserved", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, stake: true },
  });

  if (!entry) return { status: "cancelled" as const };
  return { status: "waiting" as const, queueId: entry.id, stake: Number(entry.stake) };
}
