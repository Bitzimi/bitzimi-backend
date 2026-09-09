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
    // Serialize this user's enqueue requests so two rapid clicks/retries cannot
    // both observe an empty queue and debit the same wallet twice.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:pvp_coinflip`}))`;

    const [enabled, maintenance, configuredStakes] = await Promise.all([
      getConfigValue<boolean>("game." + gameType + ".enabled", true),
      getConfigValue<boolean>("game." + gameType + ".maintenance", false),
      getConfigValue<number[]>("game." + gameType + ".stakes", []),
    ]);
    if (!enabled) throw Object.assign(new Error("pvp_coinflip is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
    if (maintenance) throw Object.assign(new Error("pvp_coinflip is under maintenance"), { statusCode: 503, code: "GAME_MAINTENANCE" });
    if (configuredStakes.length && !configuredStakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });

    // An active matched queue is the same paid search. Settled matches are
    // intentionally ignored so the result screen can start a new search.
    const matched = await tx.matchmakingQueue.findFirst({
      where: { userId, gameType, status: "matched", matchId: { not: null }, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (matched?.matchId) {
      const match = await tx.pvpMatch.findUnique({ where: { id: matched.matchId }, select: { status: true } });
      if (match?.status === "active") return { kind: "matched" as const, queueId: matched.id, matchId: matched.matchId };
    }

    // A live reservation already contains this user's paid stake. Reuse it;
    // never debit again after a reload, reconnect, duplicate click or second tab.
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
    // The match was never created/settled, so both reserved stakes can safely
    // be restored and the opponent returned to the queue.
    await db.$transaction(async tx => {
      await creditWallet(tx, userId, "game", stake);
      await creditWallet(tx, prepared.opponentId, "game", stake);
      await tx.matchmakingQueue.updateMany({ where: { id: prepared.opponentQueueId, status: "matched", matchId: null }, data: { status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    }).catch(() => {});
    throw err;
  }

  // Settlement has already been performed by the authoritative match service.
  // Persist the recovery pointers separately; a metadata failure must never
  // trigger a second refund against an already-settled match.
  await db.matchmakingQueue.update({ where: { id: prepared.opponentQueueId }, data: { matchId: match.id } });
  const mine = await db.matchmakingQueue.create({ data: { userId, gameType, stake, status: "matched", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
  return { status: "matched" as const, queueId: mine.id, matchId: match.id };
}
