/**
 * 1v1 Matchmaking — Dice Clash, Coin Flip, Reaction Tap.
 *
 * Flow:
 *   1. Player POSTs to join queue with stake amount.
 *   2. Server checks for a waiting player with same gameType + stake.
 *   3a. Match found → create PvpMatch, deduct BOTH stakes, return matchId.
 *   3b. No match → create MatchmakingQueue entry, return queueId (client polls).
 *   4. Client polls GET /games/queue/:queueId until status === "matched".
 *   5. Client then polls GET /games/matches/:matchId for result.
 *
 * Result generation:
 *   - Dice Clash / Coin Flip: result generated immediately when match is created.
 *   - Reaction Tap: server sets signalSentAt when both players ready; players
 *     submit tap times via POST /games/matches/:matchId/tap; server settles
 *     when both submitted.
 *
 * Commission: fires on EVERY player's fee (win OR loss) — Section D.
 * Queue TTL: 5 minutes. Expired entries cleaned up by ticker.
 */
import { randomInt } from "crypto";
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveDiceClash, deriveCoinFlip, generateVerificationId } from "../provablyFair";
import { db } from "../../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { recordGameResult } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";
import { activateReferral } from "../../referrals/referrals.service";

const QUEUE_TTL_MS    = 5 * 60 * 1000;  // 5 minutes
const SIGNAL_DELAY_MS = [1000, 2000, 3000, 4000, 5000]; // random signal delay range for ReactionTap

export type MatchGameType = "dice_clash" | "pvp_coinflip" | "reaction_tap";

// ── Queue cleanup ──────────────────────────────────────────────────────────────
export function startQueueCleanup(): void {
  setInterval(async () => {
    await db.matchmakingQueue.updateMany({
      where: { status: "waiting", expiresAt: { lt: new Date() } },
      data:  { status: "cancelled" },
    }).catch(() => {});
  }, 60_000);
}

// ── Join queue ─────────────────────────────────────────────────────────────────
export async function joinQueue(userId: string, gameType: MatchGameType, stake: number) {
  // Reconnect: if user already has an active match for this game type, return it
  const activeMatch = await db.pvpMatch.findFirst({
    where: {
      gameType,
      status: "active",
      OR: [{ player1Id: userId }, { player2Id: userId }],
    },
  });
  if (activeMatch) {
    // Return existing match — do not create a duplicate
    const entry = await db.matchmakingQueue.findFirst({
      where: { userId, gameType, matchId: activeMatch.id },
    });
    return { status: "matched", queueId: entry?.id ?? "", matchId: activeMatch.id };
  }

  // Reconnect: if user already has a waiting queue entry for this game+stake, return it
  const existing = await db.matchmakingQueue.findFirst({
    where: { userId, gameType, stake, status: "waiting" },
  });
  if (existing) {
    return { status: "waiting", queueId: existing.id };
  }

  // Admin-configurable availability + stake checks
  const [gameEnabled, gameMaintenance, configuredStakes] = await Promise.all([
    getConfigValue<boolean>(`game.${gameType}.enabled`,     true),
    getConfigValue<boolean>(`game.${gameType}.maintenance`, false),
    getConfigValue<number[]>(`game.${gameType}.stakes`,     []),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error(`${gameType} is currently unavailable`), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error(`${gameType} is under maintenance`),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (configuredStakes.length > 0 && !configuredStakes.includes(stake))
    throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });

  // Look for a waiting opponent
  const opponent = await db.matchmakingQueue.findFirst({
    where: {
      gameType,
      stake,
      status:    "waiting",
      userId:    { not: userId },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" }, // oldest first (FIFO)
  });

  if (opponent) {
    // Atomically claim the opponent's slot before creating the match.
    // Two concurrent joinQueue calls can both see the same opponent via findFirst;
    // only one can win this updateMany — the loser falls through to the queue.
    const claimed = await db.matchmakingQueue.updateMany({
      where: { id: opponent.id, status: "waiting" },
      data:  { status: "matched" },
    });
    if (claimed.count === 0) {
      // Another concurrent request claimed this opponent first — join queue instead
      const entry = await db.matchmakingQueue.create({
        data: {
          userId, gameType, stake, status: "waiting",
          expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
        },
      });
      return { status: "waiting", queueId: entry.id };
    }

    // Match found — create match and deduct both stakes
    const match = await createMatchForPlayers(userId, opponent.userId, gameType, stake);

    // Update the claimed entry with the new matchId
    await db.matchmakingQueue.update({
      where: { id: opponent.id },
      data:  { matchId: match.id },
    });

    // Activate referrals for both players on first game interaction
    setImmediate(() => activateReferral(userId).catch(() => {}));
    setImmediate(() => activateReferral(opponent.userId).catch(() => {}));

    // Create a matched queue entry for the joining player too
    const myQueue = await db.matchmakingQueue.create({
      data: {
        userId, gameType, stake, status: "matched", matchId: match.id,
        expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
      },
    });

    return { status: "matched", queueId: myQueue.id, matchId: match.id };
  }

  // No opponent found — add to queue
  const entry = await db.matchmakingQueue.create({
    data: {
      userId, gameType, stake, status: "waiting",
      expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
    },
  });
  return { status: "waiting", queueId: entry.id };
}

// ── Get queue status ───────────────────────────────────────────────────────────
export async function getQueueStatus(userId: string, queueId: string) {
  const entry = await db.matchmakingQueue.findFirst({ where: { id: queueId, userId } });
  if (!entry) throw Object.assign(new Error("Queue entry not found"), { statusCode: 404, code: "NOT_FOUND" });

  if (entry.status === "matched" && entry.matchId) {
    return { status: "matched", matchId: entry.matchId };
  }
  if (entry.status === "cancelled" || new Date() > entry.expiresAt) {
    return { status: "cancelled" };
  }
  return { status: "waiting" };
}

// ── Leave queue ────────────────────────────────────────────────────────────────
export async function leaveQueue(userId: string, queueId: string) {
  const entry = await db.matchmakingQueue.findFirst({ where: { id: queueId, userId, status: "waiting" } });
  if (!entry) return; // already matched or cancelled
  await db.matchmakingQueue.update({ where: { id: queueId }, data: { status: "cancelled" } });
}

// ── Create match — exported so privateRoom.service.ts can reuse without duplication ──
export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2;
  const feeRate   = await getGameFeeRate(gameType);
  const fee       = totalPool * feeRate;

  // Deduct stakes from both players
  await db.$transaction(async (tx) => {
    for (const pid of [player1Id, player2Id]) {
      await debitWallet(tx, pid, "game", stake);
      await writeLedgerEntry(tx, { userId: pid, type: "game_bet", fromWallet: "game", amount: stake,
        description: `${gameType} match entry`, referenceType: "pvp_match", metadata: { gameType, stake } });
    }
  });

  const serverSeed     = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  // Verification ID generated for provably fair games only (not reaction_tap)
  const verificationId = (gameType === "dice_clash" || gameType === "pvp_coinflip")
    ? generateVerificationId(gameType)
    : undefined;

  const match = await db.pvpMatch.create({
    data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId },
  });

  // For dice_clash and pvp_coinflip: generate result immediately
  if (gameType === "dice_clash") {
    await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate);
  } else if (gameType === "pvp_coinflip") {
    await resolveCoinFlip(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate);
  }
  // reaction_tap: result generated after both players submit tap times

  return db.pvpMatch.findUnique({ where: { id: match.id } }) as Promise<NonNullable<Awaited<ReturnType<typeof db.pvpMatch.findUnique>>>>;
}

// ── Dice Clash resolution ──────────────────────────────────────────────────────
async function resolveDiceClash(matchId: string, p1Id: string, p2Id: string, stake: number, fee: number, totalPool: number, serverSeed: string, feeRate: number) {
  // clientSeed from sorted player IDs + matchId (public, determined after commitment)
  const clientSeed = generateClientSeed(...[p1Id, p2Id].sort(), matchId);
  const { p1Roll, p2Roll } = deriveDiceClash(serverSeed, clientSeed, 1);

  const winnerId  = p1Roll > p2Roll ? p1Id : p2Id;
  const loserId   = winnerId === p1Id ? p2Id : p1Id;
  const payout    = totalPool - fee;
  const resultData = JSON.stringify({ p1Roll, p2Roll, winnerId });

  await db.$transaction(async (tx) => {
    await creditWallet(tx, winnerId, "game", payout);
    await writeLedgerEntry(tx, { userId: winnerId, type: "game_win", toWallet: "game", amount: payout,
      description: "Dice clash win", referenceId: matchId, referenceType: "pvp_match" });
    await tx.pvpMatch.update({
      where: { id: matchId },
      data:  { status: "settled", winnerId, resultData, settledAt: new Date(), serverSeed, clientSeed, nonce: 1 },
    });
    await recordGameResult({ tx, userId: winnerId, gameType: "dice_clash", wagered: stake, won: true,  payout });
    await recordGameResult({ tx, userId: loserId,  gameType: "dice_clash", wagered: stake, won: false, payout: 0 });
    // Section D: commission jobs created atomically with settlement
    const userFee = stake * feeRate;
    await createGameFeeJobInTx(tx, { userId: winnerId, userFee, isMultiGame: false, eventRefId: matchId });
    await createGameFeeJobInTx(tx, { userId: loserId,  userFee, isMultiGame: false, eventRefId: matchId });
  });
}

// ── Coin Flip resolution ───────────────────────────────────────────────────────
async function resolveCoinFlip(matchId: string, p1Id: string, p2Id: string, stake: number, fee: number, totalPool: number, serverSeed: string, feeRate: number) {
  const clientSeed = generateClientSeed(...[p1Id, p2Id].sort(), matchId);
  const coinFlip   = deriveCoinFlip(serverSeed, clientSeed, 1);
  // p1 always calls heads (deterministic by join order); p2 always gets tails
  const p1Side     = "heads";
  const p2Side     = "tails";
  const winnerId   = coinFlip === p1Side ? p1Id : p2Id;
  const loserId    = winnerId === p1Id ? p2Id : p1Id;
  const payout     = totalPool - fee;
  const resultData = JSON.stringify({ p1Side, p2Side, coinFlip, winnerId });

  await db.$transaction(async (tx) => {
    await creditWallet(tx, winnerId, "game", payout);
    await writeLedgerEntry(tx, { userId: winnerId, type: "game_win", toWallet: "game", amount: payout,
      description: "Coin flip win", referenceId: matchId, referenceType: "pvp_match" });
    await tx.pvpMatch.update({
      where: { id: matchId },
      data:  { status: "settled", winnerId, resultData, settledAt: new Date(), serverSeed, clientSeed, nonce: 1 },
    });
    await recordGameResult({ tx, userId: winnerId, gameType: "pvp_coinflip", wagered: stake, won: true,  payout });
    await recordGameResult({ tx, userId: loserId,  gameType: "pvp_coinflip", wagered: stake, won: false, payout: 0 });
    // Section D: commission jobs created atomically with settlement
    const userFee = stake * feeRate;
    await createGameFeeJobInTx(tx, { userId: winnerId, userFee, isMultiGame: false, eventRefId: matchId });
    await createGameFeeJobInTx(tx, { userId: loserId,  userFee, isMultiGame: false, eventRefId: matchId });
  });
}

// ── Get match state ────────────────────────────────────────────────────────────
export async function getMatch(userId: string, matchId: string) {
  const match = await db.pvpMatch.findFirst({
    where: { id: matchId, OR: [{ player1Id: userId }, { player2Id: userId }] },
    include: {
      player1: { include: { profile: { select: { username: true } } } },
      player2: { include: { profile: { select: { username: true } } } },
    },
  });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404, code: "NOT_FOUND" });

  const isPlayer1  = match.player1Id === userId;
  const opponent   = isPlayer1 ? match.player2 : match.player1;
  const resultData = match.resultData ? JSON.parse(match.resultData) : null;
  const totalPool  = match.stake * 2;
  const feeRate    = await getGameFeeRate(match.gameType as MatchGameType);
  const fee        = totalPool * feeRate;

  return {
    matchId:       match.id,
    gameType:      match.gameType,
    stake:         match.stake,
    totalPool,
    platformFee:   fee,
    status:        match.status,
    isPlayer1,
    opponent: {
      username:    opponent.profile?.username ?? "Player",
      userId:      opponent.id,
    },
    result:        resultData,
    winnerId:      match.winnerId,
    youWon:        match.winnerId === userId,
    payout:        match.winnerId === userId ? totalPool - fee : 0,
    createdAt:     match.createdAt.toISOString(),
    settledAt:     match.settledAt?.toISOString() ?? null,
    // ReactionTap fields
    signalSentAt:  match.signalSentAt?.toISOString() ?? null,
    yourReady:     isPlayer1 ? match.player1Ready : match.player2Ready,
    opponentReady: isPlayer1 ? match.player2Ready : match.player1Ready,
  };
}

// ── Reaction Tap: signal ready ─────────────────────────────────────────────────
// Timeout: 20 s after signalSentAt — if both taps not received, award the one who
// tapped, or refund both if neither tapped.
const REACTION_TAP_TIMEOUT_MS = 20_000;

export async function signalReady(userId: string, matchId: string) {
  const match = await db.pvpMatch.findFirst({
    where: { id: matchId, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] },
  });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404, code: "NOT_FOUND" });

  const isPlayer1 = match.player1Id === userId;
  const update: any = isPlayer1 ? { player1Ready: true } : { player2Ready: true };

  const updated = await db.pvpMatch.update({ where: { id: matchId }, data: update });

  // Both ready → set signal time and schedule timeout
  if (updated.player1Ready && updated.player2Ready && !updated.signalSentAt) {
    const delayMs      = SIGNAL_DELAY_MS[randomInt(SIGNAL_DELAY_MS.length)];
    const signalSentAt = new Date(Date.now() + delayMs);
    await db.pvpMatch.update({ where: { id: matchId }, data: { signalSentAt } });

    // Schedule timeout: award the tapper (or refund) if match not settled in time
    const timeoutMs = delayMs + REACTION_TAP_TIMEOUT_MS;
    setTimeout(
      () => timeoutReactionTap(matchId, match.player1Id, match.player2Id, match.stake).catch(() => {}),
      timeoutMs,
    );

    return { signalSentAt: signalSentAt.toISOString(), delayMs };
  }

  return { waiting: true };
}

// ── Reaction Tap: submit tap time ──────────────────────────────────────────────
// tapMs is measured by client relative to signalSentAt.
//   tapMs < 0  → early tap (player tapped BEFORE the signal) — treated as forfeit / instant loss.
//   tapMs >= 0 → normal reaction time in milliseconds.
export async function submitTap(userId: string, matchId: string, tapMs: number) {
  const match = await db.pvpMatch.findFirst({
    where: { id: matchId, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] },
  });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (!match.signalSentAt) throw Object.assign(new Error("Signal not yet sent"), { statusCode: 400, code: "SIGNAL_NOT_SENT" });

  const isPlayer1  = match.player1Id === userId;
  const updateData: any = isPlayer1 ? { player1TapMs: tapMs } : { player2TapMs: tapMs };
  const updated    = await db.pvpMatch.update({ where: { id: matchId }, data: updateData });

  // Both tapped → settle
  if (updated.player1TapMs !== null && updated.player2TapMs !== null) {
    await resolveReactionTap(matchId, match.player1Id, match.player2Id, match.stake, updated.player1TapMs!, updated.player2TapMs!);
  }

  return { submitted: true };
}

// ── Reaction Tap: resolve with early-tap / draw handling ──────────────────────
async function resolveReactionTap(matchId: string, p1Id: string, p2Id: string, stake: number, p1Tap: number, p2Tap: number) {
  // Negative tapMs = early tap = forfeit (instant loss).
  // Both forfeited → void round; refund both stakes.
  const p1Forfeited = p1Tap < 0;
  const p2Forfeited = p2Tap < 0;

  if (p1Forfeited && p2Forfeited) {
    // Void: both forfeited, refund 100%.
    // Guard and wallet credits are in one $transaction: a crash after the status
    // update but before crediting would leave the match permanently "cancelled"
    // with no refund issued. Atomic placement eliminates this window.
    await db.$transaction(async (tx) => {
      const guard = await tx.pvpMatch.updateMany({
        where: { id: matchId, status: "active" },
        data:  { status: "cancelled", resultData: JSON.stringify({ p1TapMs: p1Tap, p2TapMs: p2Tap, void: true }), settledAt: new Date() },
      });
      if (guard.count === 0) return;
      for (const pid of [p1Id, p2Id]) {
        await creditWallet(tx, pid, "game", stake);
        await writeLedgerEntry(tx, { userId: pid, type: "transfer", toWallet: "game", amount: stake,
          description: "Reaction tap void — both forfeited, refund", referenceId: matchId, referenceType: "pvp_match" });
        await recordGameResult({ tx, userId: pid, gameType: "reaction_tap", wagered: stake, won: false, payout: stake });
      }
    });
    return;
  }

  // One forfeited → the other wins automatically
  const totalPool  = stake * 2;
  const feeRate    = await getGameFeeRate("reaction_tap");
  const fee        = totalPool * feeRate;
  const payout     = totalPool - fee;

  let winnerId: string;
  let loserId: string;

  if (p1Forfeited) {
    winnerId = p2Id; loserId = p1Id;
  } else if (p2Forfeited) {
    winnerId = p1Id; loserId = p2Id;
  } else {
    // Both tapped normally — faster tap wins; tie → smaller playerId wins (deterministic)
    if (p1Tap === p2Tap) {
      winnerId = p1Id < p2Id ? p1Id : p2Id;
    } else {
      winnerId = p1Tap < p2Tap ? p1Id : p2Id;
    }
    loserId = winnerId === p1Id ? p2Id : p1Id;
  }

  const resultData = JSON.stringify({ p1TapMs: p1Tap, p2TapMs: p2Tap, winnerId, p1Forfeited, p2Forfeited });

  // Guard and wallet credit in one $transaction: a crash between the two separate
  // operations would leave the match permanently "settled" with no payout.
  await db.$transaction(async (tx) => {
    const guard = await tx.pvpMatch.updateMany({
      where: { id: matchId, status: "active" },
      data:  { status: "settled", winnerId, resultData, settledAt: new Date() },
    });
    if (guard.count === 0) return; // concurrent call already settled
    await creditWallet(tx, winnerId, "game", payout);
    await writeLedgerEntry(tx, { userId: winnerId, type: "game_win", toWallet: "game", amount: payout,
      description: "Reaction tap win", referenceId: matchId, referenceType: "pvp_match" });
    await recordGameResult({ tx, userId: winnerId, gameType: "reaction_tap", wagered: stake, won: true,  payout });
    await recordGameResult({ tx, userId: loserId,  gameType: "reaction_tap", wagered: stake, won: false, payout: 0 });
    // Section D: commission jobs created atomically with settlement
    const userFee = stake * feeRate;
    await createGameFeeJobInTx(tx, { userId: winnerId, userFee, isMultiGame: false, eventRefId: matchId });
    await createGameFeeJobInTx(tx, { userId: loserId,  userFee, isMultiGame: false, eventRefId: matchId });
  });
}

// ── Reaction Tap: timeout handler ──────────────────────────────────────────────
// Called 20 s after signalSentAt. Handles three cases:
//   • Both tapped (settled already) → no-op (guard.count === 0)
//   • One tapped, other didn't → the tapper wins
//   • Neither tapped → refund both (void)
async function timeoutReactionTap(matchId: string, p1Id: string, p2Id: string, stake: number) {
  const match = await db.pvpMatch.findFirst({ where: { id: matchId, status: "active" } });
  if (!match) return; // already settled

  const p1Tapped = match.player1TapMs !== null;
  const p2Tapped = match.player2TapMs !== null;

  if (!p1Tapped && !p2Tapped) {
    // Neither tapped — void round, full refund. Guard and credits in one $transaction.
    await db.$transaction(async (tx) => {
      const guard = await tx.pvpMatch.updateMany({
        where: { id: matchId, status: "active" },
        data:  { status: "cancelled", resultData: JSON.stringify({ timeout: true, void: true }), settledAt: new Date() },
      });
      if (guard.count === 0) return;
      for (const pid of [p1Id, p2Id]) {
        await creditWallet(tx, pid, "game", stake);
        await writeLedgerEntry(tx, { userId: pid, type: "transfer", toWallet: "game", amount: stake,
          description: "Reaction tap timeout — both void, refund", referenceId: matchId, referenceType: "pvp_match" });
        await recordGameResult({ tx, userId: pid, gameType: "reaction_tap", wagered: stake, won: false, payout: stake });
      }
    });
    return;
  }

  // One tapped, one didn't — the non-tapper forfeits (treated as infinite tap time)
  const p1Tap = p1Tapped ? match.player1TapMs! : Number.MAX_SAFE_INTEGER;
  const p2Tap = p2Tapped ? match.player2TapMs! : Number.MAX_SAFE_INTEGER;
  await resolveReactionTap(matchId, p1Id, p2Id, stake, p1Tap, p2Tap);
}
