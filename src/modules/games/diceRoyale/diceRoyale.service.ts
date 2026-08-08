/**
 * Dice Royale — real-player per-stake rounds.
 *
 * ARCHITECTURE (Phase 3F Section F):
 *   - Real players only. No bots.
 *   - Any player can view the current open round for a given stake.
 *   - Player manually clicks JOIN ROUND (no auto-join).
 *   - Countdown begins when the SECOND player joins.
 *   - Betting closes 5s before round ends (locked phase).
 *   - Max 6 players per round.
 *   - 1 winner takes all (minus 10% platform fee).
 *   - Commission on EVERY player's fee (win OR loss) — Section D.
 */
import { db } from "../../../db";
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveDiceRolls, deriveTieBreakRolls, generateVerificationId } from "../provablyFair";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { recordGameResult } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";
import { activateReferral } from "../../referrals/referrals.service";

const MAX_PLAYERS      = 6;
const MIN_TO_START     = 2;     // countdown starts on 2nd player
const COUNTDOWN_MS     = 30_000;
const LOCK_BEFORE_MS   = 5_000; // betting closes 5s before end
const RESULT_MS        = 8_000;

interface RoyaleRoundState {
  roundId:           string;
  roundNumber:       number;
  stake:             number;
  status:            "open" | "countdown" | "locked" | "rolling" | "result" | "completed" | "cancelled";
  players:           string[];
  countdownStartedAt:number | null;
  resultData:        any | null;
  serverSeed:        string;
  serverSeedHash:    string;
}

// In-memory index: key = stake → active round state
const royaleRounds = new Map<string, RoyaleRoundState>();
const royaleCounters: Record<string, number> = {};

// Creation lock: prevents concurrent createNewRound() calls for same stake
const royaleCreating = new Set<string>();

// Pending-join sets per round: synchronous mutex that blocks same user joining twice concurrently.
// Checked + updated before any await — Node.js single-thread guarantees atomicity.
const royalePendingJoins = new Map<string, Set<string>>(); // roundId → Set<userId>

/**
 * Instance key generator — generalizes runtime state keys to support future room functionality.
 * Returns string-based key for runtime Maps/Sets/Records.
 */
function instanceKey(stake: number, roomId?: string): string {
  return roomId === undefined ? String(stake) : `${stake}:${roomId}`;
}

async function getOrCreateRound(stake: number): Promise<RoyaleRoundState> {
  const key = instanceKey(stake);
  const existing = royaleRounds.get(key);
  if (existing && ["open", "countdown", "locked", "rolling"].includes(existing.status)) return existing;

  // Look in DB for an open round with this stake
  const dbRound = await db.diceRound.findFirst({
    where: { gameType: "dice_royale", stake, status: { in: ["open", "countdown", "locked", "rolling"] } },
    orderBy: { createdAt: "desc" },
  });
  if (dbRound) {
    const playerIds: string[] = JSON.parse(dbRound.playerIds);
    const recoveredSeed = dbRound.serverSeed ?? generateServerSeed();
    const state: RoyaleRoundState = {
      roundId: dbRound.id, roundNumber: dbRound.roundNumber, stake,
      status: dbRound.status as RoyaleRoundState["status"],
      players: playerIds,
      countdownStartedAt: dbRound.countdownStartedAt ? dbRound.countdownStartedAt.getTime() : null,
      resultData: null,
      serverSeed:     recoveredSeed,
      serverSeedHash: dbRound.serverSeedHash ?? hashServerSeed(recoveredSeed),
    };
    royaleRounds.set(key, state);
    return state;
  }

  // Creation lock: if another async call is already creating for this stake, wait briefly then re-check
  if (royaleCreating.has(key)) {
    await new Promise(r => setTimeout(r, 100));
    return getOrCreateRound(stake);
  }

  royaleCreating.add(key);
  try {
    return await createNewRound(stake);
  } finally {
    royaleCreating.delete(key);
  }
}

async function createNewRound(stake: number): Promise<RoyaleRoundState> {
  const key        = instanceKey(stake);
  const roundNumber = (royaleCounters[key] ?? 0) + 1;
  royaleCounters[key] = roundNumber;
  const serverSeed     = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const round = await db.diceRound.create({
    data: { gameType: "dice_royale", stake, roundNumber, maxPlayers: MAX_PLAYERS, minPlayersToStart: MIN_TO_START, serverSeed, serverSeedHash, verificationId: generateVerificationId("dice_royale") },
  });
  const state: RoyaleRoundState = {
    roundId: round.id, roundNumber, stake, status: "open", players: [],
    countdownStartedAt: null, resultData: null, serverSeed, serverSeedHash,
  };
  royaleRounds.set(key, state);
  return state;
}

// ── Per-round ticker ────────────────────────────────────────────────────────────
async function tickRoyaleRound(stake: number): Promise<void> {
  const key = instanceKey(stake);
  const state = royaleRounds.get(key);
  if (!state || (state.status !== "countdown" && state.status !== "locked")) return;

  const elapsed   = Date.now() - (state.countdownStartedAt ?? Date.now());
  const remaining = COUNTDOWN_MS - elapsed;

  if (remaining <= LOCK_BEFORE_MS && state.status === "countdown") {
    state.status = "locked";
    await db.diceRound.update({ where: { id: state.roundId }, data: { status: "locked", playerIds: JSON.stringify(state.players) } });
  }
  if (remaining <= 0) {
    await settleRoyaleRound(stake, state);
  }
}

async function settleRoyaleRound(stake: number, state: RoyaleRoundState): Promise<void> {
  if (state.players.length < 2) {
    // Not enough players — cancel and refund
    state.status = "cancelled";
    await db.$transaction(async (tx) => {
      for (const pid of state.players) {
        await creditWallet(tx, pid, "game", stake);
        await writeLedgerEntry(tx, { userId: pid, type: "transfer", toWallet: "game", amount: stake,
          description: "Dice royale cancelled — refund", referenceType: "game_round", metadata: { roundId: state.roundId } });
      }
    });
    await db.diceRound.update({ where: { id: state.roundId }, data: { status: "cancelled", settledAt: new Date() } });
    const key = instanceKey(stake);
    royaleRounds.delete(key);
    return;
  }

  // Idempotency guard: atomically transition "locked" → "rolling" at DB level.
  // If another ticker call already transitioned, count will be 0 — abort to prevent double-settlement.
  const guard = await db.diceRound.updateMany({
    where: { id: state.roundId, status: { in: ["locked", "countdown", "open"] } },
    data:  { status: "rolling" },
  });
  if (guard.count === 0) {
    const key = instanceKey(stake);
    royaleRounds.delete(key);
    return; // already settled by a previous call
  }
  state.status = "rolling";

  // PF dice rolls — clientSeed from sorted player IDs + roundId (locked public data)
  const sortedIds  = [...state.players].sort();
  const clientSeed = generateClientSeed(...sortedIds, state.roundId);
  const rolls      = deriveDiceRolls(state.serverSeed, clientSeed, state.roundNumber, sortedIds);

  // Determine winner: highest roll; ties resolved by deterministic tie-break nonces
  let maxRoll    = Math.max(...Object.values(rolls));
  let candidates = state.players.filter(p => rolls[p] === maxRoll);
  let tbRound    = 1;
  while (candidates.length > 1) {
    const tbRolls   = deriveTieBreakRolls(state.serverSeed, clientSeed, state.roundNumber, tbRound, candidates);
    Object.assign(rolls, tbRolls);
    maxRoll    = Math.max(...candidates.map(p => rolls[p]));
    candidates = candidates.filter(p => rolls[p] === maxRoll);
    tbRound++;
  }
  const winnerId  = candidates[0];
  const totalPool = stake * state.players.length;
  const feeRate   = await getGameFeeRate("dice_royale");
  const fee       = totalPool * feeRate;
  const payout    = totalPool - fee;
  const resultData = { rolls, winnerId, totalPool, fee, payout };
  state.resultData = resultData;

  await db.$transaction(async (tx) => {
    await creditWallet(tx, winnerId, "game", payout);
    await writeLedgerEntry(tx, { userId: winnerId, type: "game_win", toWallet: "game", amount: payout,
      description: "Dice royale win", referenceType: "game_round", metadata: { roundId: state.roundId, totalPool } });
    await tx.diceRound.update({
      where: { id: state.roundId },
      data:  {
        status:     "result",
        resultData: JSON.stringify(resultData),
        settledAt:  new Date(),
        serverSeed: state.serverSeed,
        clientSeed,
        nonce:      state.roundNumber,
      },
    });
    for (const pid of state.players) {
      await recordGameResult({ tx, userId: pid, gameType: "dice_royale", wagered: stake, won: pid === winnerId, payout: pid === winnerId ? payout : 0 });
    }
    // Section D: commission job created atomically with settlement — never lost if DB recovers
    const userFee = stake * feeRate;
    for (const pid of state.players) {
      await createGameFeeJobInTx(tx, { userId: pid, userFee, isMultiGame: true, eventRefId: state.roundId });
    }
  });
  state.status = "result";

  setTimeout(() => {
    state.status = "completed";
    const key = instanceKey(stake);
    royaleRounds.delete(key);
    db.diceRound.update({ where: { id: state.roundId }, data: { status: "completed" } }).catch(() => {});
  }, RESULT_MS);
}

// Start per-stake tickers for all active rounds
const stakeTimers = new Set<string>();
function ensureTicker(stake: number): void {
  const key = instanceKey(stake);
  if (stakeTimers.has(key)) return;
  stakeTimers.add(key);
  setInterval(() => tickRoyaleRound(stake).catch(() => {}), 500);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getRoyaleRound(stake: number) {
  const state = await getOrCreateRound(stake);
  const timeRemaining = state.countdownStartedAt
    ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000))
    : null;
  return {
    roundId:        state.roundId,
    roundNumber:    state.roundNumber,
    stake,
    status:         state.status,
    playerCount:    state.players.length,
    maxPlayers:     MAX_PLAYERS,
    canJoin:        ["open", "countdown"].includes(state.status) && state.players.length < MAX_PLAYERS,
    timeRemaining,
    resultData:     state.status === "result" || state.status === "completed" ? state.resultData : null,
    serverSeedHash: state.serverSeedHash,
  };
}

export async function joinRoyaleRound(userId: string, stake: number) {
  // Admin-configurable availability + stake checks
  const [gameEnabled, gameMaintenance, configuredStakes] = await Promise.all([
    getConfigValue<boolean>("game.dice_royale.enabled",     true),
    getConfigValue<boolean>("game.dice_royale.maintenance", false),
    getConfigValue<number[]>("game.dice_royale.stakes",     []),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error("Dice Royale is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error("Dice Royale is under maintenance"),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (configuredStakes.length > 0 && !configuredStakes.includes(stake))
    throw Object.assign(new Error(`Stake $${stake} is not available`), { statusCode: 400, code: "INVALID_STAKE" });

  ensureTicker(stake);
  const state = await getOrCreateRound(stake);

  if (!["open", "countdown"].includes(state.status)) {
    throw Object.assign(new Error(`Round is not open — status: ${state.status}`), { statusCode: 409, code: "ROUND_NOT_OPEN" });
  }
  if (state.players.length >= MAX_PLAYERS) {
    throw Object.assign(new Error("Round is full"), { statusCode: 409, code: "ROUND_FULL" });
  }

  // Synchronous pending guard — blocks same user joining twice concurrently.
  const pending = royalePendingJoins.get(state.roundId) ?? new Set<string>();
  if (state.players.includes(userId) || pending.has(userId)) {
    throw Object.assign(new Error("You already joined this round"), { statusCode: 409, code: "ALREADY_JOINED" });
  }
  pending.add(userId);
  royalePendingJoins.set(state.roundId, pending);

  try {
    await db.$transaction(async (tx) => {
      // DB-level duplicate guard: DiceRound.playerIds is the source of truth
      const dbRound = await tx.diceRound.findUnique({ where: { id: state.roundId }, select: { playerIds: true } });
      const existingIds: string[] = dbRound ? JSON.parse(dbRound.playerIds) : [];
      if (existingIds.includes(userId)) {
        throw Object.assign(new Error("You already joined this round"), { statusCode: 409, code: "ALREADY_JOINED" });
      }

      const w = await tx.wallet.findUnique({ where: { userId_walletType: { userId, walletType: "game" } } });
      if (!w || w.balance < stake) {
        throw Object.assign(new Error("Insufficient game wallet balance"), { statusCode: 400, code: "INSUFFICIENT_BALANCE" });
      }
      await debitWallet(tx, userId, "game", stake);
      await writeLedgerEntry(tx, { userId, type: "game_bet", fromWallet: "game", amount: stake,
        description: `Dice royale entry — stake ${stake}`, referenceType: "game_round",
        metadata: { roundId: state.roundId, stake } });
      // Update playerIds in DB atomically with wallet deduction
      const newIds = [...existingIds, userId];
      await tx.diceRound.update({ where: { id: state.roundId }, data: { playerIds: JSON.stringify(newIds) } });
    });

    state.players.push(userId);
  } finally {
    pending.delete(userId);
  }

  // Countdown starts on 2nd player (playerIds already updated in transaction above)
  if (state.players.length === MIN_TO_START && state.countdownStartedAt === null) {
    state.countdownStartedAt = Date.now();
    state.status = "countdown";
    await db.diceRound.update({
      where: { id: state.roundId },
      data:  { status: "countdown", playerIds: JSON.stringify(state.players), countdownStartedAt: new Date() },
    });
  }
  // Note: playerIds written to DB inside the transaction above — no extra update needed

  setImmediate(() => activateReferral(userId).catch(() => {}));

  return {
    roundId:      state.roundId,
    stake,
    playerCount:  state.players.length,
    maxPlayers:   MAX_PLAYERS,
    status:       state.status,
    timeRemaining: state.countdownStartedAt
      ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000))
      : null,
  };
}

export async function leaveRoyaleRound(userId: string, roundId: string) {
  const state = [...royaleRounds.values()].find(r => r.roundId === roundId);
  if (!state || !["open"].includes(state.status)) {
    throw Object.assign(new Error("Cannot leave — round has started or does not exist"), { statusCode: 409, code: "CANNOT_LEAVE" });
  }
  if (!state.players.includes(userId)) {
    throw Object.assign(new Error("You are not in this round"), { statusCode: 400, code: "NOT_IN_ROUND" });
  }
  state.players = state.players.filter(id => id !== userId);
  await db.$transaction(async (tx) => {
    await creditWallet(tx, userId, "game", state.stake);
    await writeLedgerEntry(tx, { userId, type: "transfer", toWallet: "game", amount: state.stake,
      description: "Dice royale — player left, refund", referenceType: "game_round", metadata: { roundId } });
    await tx.diceRound.update({ where: { id: state.roundId }, data: { playerIds: JSON.stringify(state.players) } });
  });
}