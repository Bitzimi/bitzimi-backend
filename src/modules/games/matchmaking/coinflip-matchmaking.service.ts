import { db } from "../../../db";
import { debitWallet, creditWallet } from "../../wallets/wallets.service";
import { getConfigValue } from "../../admin/config/admin.config.service";
import { createReservedMatchForPlayers } from "./matchmaking.service";

const QUEUE_TTL_MS = 5 * 60_000;

/**
 * Coin Flip uses a paid queue, so enqueue must be idempotent.
 * A browser retry/reload is never allowed to create another paid reservation.
 */
export async function joinCoinFlipQueueIdempotent(userId: string, stake: number) {
  const gameType = "pvp_coinflip" as const;
  const now = new Date();

  const prepared = await db.$transaction(async tx => {
    // Serialize queue creation for this user. This closes the race where two
    // simultaneous POSTs both see no queue and both debit the same wallet.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:pvp_coinflip`}))`;

    const [enabled, maintenance, configuredStakes] = await Promise.all([
      getConfigValue<boolean>("game." + gameType + ".enabled", true),
      getConfigValue<boolean>("game." + gameType + ".maintenance", false),
      getConfigValue<number[]>("game." + gameType + ".stakes", []),
    ]);
    if (!enabled) throw Object.assign(new Error("pvp_coinflip is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
    if (maintenance) throw Object.assign(new Error("pvp_coinflip is under maintenance"), { statusCode: 503, code: "GAME_MAINTENANCE" });
    if (configuredStakes.length && !configuredStakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });

    // A still-active matched queue is the same paid search. Return it instead
    // of charging the user again. Settled matches are intentionally ignored so
    // the result screen can start a genuinely new search.
    const matched = await tx.matchmakingQueue.findFirst({
      where: { userId, gameType, status: "matched", matchId: { not: null }, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (matched?.matchId) {
      const match = await tx.pvpMatch.findUnique({ where: { id: matched.matchId }, select: { status: true } });
      if (match?.status === "active") return { kind: "matched" as const, queueId: matched.id, matchId: matched.matchId };
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

  try {
    const match = await createReservedMatchForPlayers(userId, prepared.opponentId, gameType, stake);
    // The money and match settlement are already authoritative at this point.
    // Queue metadata is persisted immediately so both clients can recover it.
    await db.matchmakingQueue.update({ where: { id: prepared.opponentQueueId }, data: { matchId: match.id } });
    const mine = await db.matchmakingQueue.create({ data: { userId, gameType, stake, status: "matched", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
    return { status: "matched" as const, queueId: mine.id, matchId: match.id };
  } catch (err) {
    // If match creation itself failed, no settlement exists and both reservations
    // can safely be restored. Never refund blindly after a successful match.
    const matchExists = await db.pvpMatch.findFirst({ where: { gameType, stake, OR: [{ player1Id: userId, player2Id: prepared.opponentId }, { player1Id: prepared.opponentId, player2Id: userId }], createdAt: { gt: new Date(Date.now() - 60_000) } });
    if (!matchExists) {
      await db.$transaction(async tx => {
        await creditWallet(tx, userId, "game", stake);
        await creditWallet(tx, prepared.opponentId, "game", stake);
        await tx.matchmakingQueue.updateMany({ where: { id: prepared.opponentQueueId, status: "matched", matchId: null }, data: { status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });
      }).catch(() => {});
    }
    throw err;
  }
}
