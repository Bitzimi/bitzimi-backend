/**
 * Dice Arena — real-player per-stake rounds.
 * Two winners: 1st place gets 60%, 2nd place gets 40% of prize pool (minus 10% fee).
 * Countdown starts on the THIRD player joining.
 */
import { db } from "../../../db";
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveDiceRolls, deriveTieBreakRolls, generateVerificationId } from "../provablyFair";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { recordGameResult } from "../settlement";
import { triggerGameFeeCommission } from "../../affiliates/commissions";
import { activateReferral } from "../../referrals/referrals.service";

const MAX_PLAYERS    = 6;
const MIN_TO_START   = 3;     // countdown starts on 3rd player
const COUNTDOWN_MS   = 30_000;
const LOCK_BEFORE_MS = 5_000;
const RESULT_MS      = 8_000;

interface ArenaRoundState {
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

const arenaRounds   = new Map<string, ArenaRoundState>();
const arenaCounters: Record<string, number> = {};
const arenaCreating = new Set<string>(); // creation lock to prevent duplicate rounds

// Pending-join sets per round: synchronous duplicate-join mutex
const arenaPendingJoins = new Map<string, Set<string>>(); // roundId → Set<userId>

/**
 * Instance key generator — generalizes runtime state keys to support future room functionality.
 * Returns string-based key for runtime Maps/Sets/Records.
 */
function instanceKey(stake: number, roomId?: string): string {
  return roomId === undefined ? String(stake) : `${stake}:${roomId}`;
}

async function getOrCreateArenaRound(stake: number): Promise<ArenaRoundState> {
  const key = instanceKey(stake);
  const existing = arenaRounds.get(key);
  if (existing && ["open", "countdown"].includes(existing.status)) return existing;

  const dbRound = await db.diceRound.findFirst({
    where: { gameType: "dice_arena", stake, status: { in: ["open", "countdown"] } },
    orderBy: { createdAt: "desc" },
  });
  if (dbRound) {
    const recoveredSeed = dbRound.serverSeed ?? generateServerSeed();
    const state: ArenaRoundState = {
      roundId: dbRound.id, roundNumber: dbRound.roundNumber, stake,
      status: dbRound.status as ArenaRoundState["status"],
      players: JSON.parse(dbRound.playerIds),
      countdownStartedAt: dbRound.countdownStartedAt ? dbRound.countdownStartedAt.getTime() : null,
      resultData: null,
      serverSeed:     recoveredSeed,
      serverSeedHash: dbRound.serverSeedHash ?? hashServerSeed(recoveredSeed),
    };
    arenaRounds.set(key, state);
    return state;
  }

  // Creation lock: prevents two concurrent calls from creating two open rounds
  if (arenaCreating.has(key)) {
    await new Promise(r => setTimeout(r, 100));
    return getOrCreateArenaRound(stake);
  }

  arenaCreating.add(key);
  try {
    const roundNumber    = (arenaCounters[key] ?? 0) + 1;
    arenaCounters[key]   = roundNumber;
    const serverSeed     = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const round = await db.diceRound.create({
      data: { gameType: "dice_arena", stake, roundNumber, maxPlayers: MAX_PLAYERS, minPlayersToStart: MIN_TO_START, serverSeed, serverSeedHash, verificationId: generateVerificationId("dice_arena") },
    });
    const state: ArenaRoundState = {
      roundId: round.id, roundNumber, stake, status: "open", players: [],
      countdownStartedAt: null, resultData: null, serverSeed, serverSeedHash,
    };
    arenaRounds.set(key, state);
    return state;
  } finally {
    arenaCreating.delete(key);
  }
}

async function settleArenaRound(stake: number, state: ArenaRoundState): Promise<void> {
  if (state.players.length < 2) {
    state.status = "cancelled";
    await db.$transaction(async (tx) => {
      for (const pid of state.players) {
        await creditWallet(tx, pid, "game", stake);
        await writeLedgerEntry(tx, { userId: pid, type: "transfer", toWallet: "game", amount: stake,
          description: "Dice arena cancelled — refund", referenceType: "game_round", metadata: { roundId: state.roundId } });
      }
    });
    await db.diceRound.update({ where: { id: state.roundId }, data: { status: "cancelled", settledAt: new Date() } });
    const key = instanceKey(stake);
    arenaRounds.delete(key);
    return;
  }

  // Idempotency guard — atomic DB status transition prevents double-settlement
  const guard = await db.diceRound.updateMany({
    where: { id: state.roundId, status: { in: ["locked", "countdown", "open"] } },
    data:  { status: "rolling" },
  });
  if (guard.count === 0) {
    const key = instanceKey(stake);
    arenaRounds.delete(key);
    return;
  }
  state.status = "rolling";

  // PF dice rolls — clientSeed from sorted player IDs + roundId
  const sortedIds  = [...state.players].sort();
  const clientSeed = generateClientSeed(...sortedIds, state.roundId);
  const rolls      = deriveDiceRolls(state.serverSeed, clientSeed, state.roundNumber, sortedIds);

  // Sort by dice value descending
  const ranked = [...state.players].sort((a, b) => rolls[b] - rolls[a]);
  let first  = ranked[0];
  let second = ranked[1];
  // If 1st and 2nd are tied → deterministic tie-break
  let tbRound = 1;
  while (second && rolls[first] === rolls[second] && first !== second) {
    const tbRolls = deriveTieBreakRolls(state.serverSeed, clientSeed, state.roundNumber, tbRound, [first, second]);
    Object.assign(rolls, tbRolls);
    const tbRanked = [first, second].sort((a, b) => rolls[b] - rolls[a]);
    first  = tbRanked[0];
    second = tbRanked[1];
    tbRound++;
  }
  second = second ?? first; // fallback if <2 players

  const totalPool  = stake * state.players.length;
  const feeRate    = await getGameFeeRate("dice_arena");
  const fee        = totalPool * feeRate;
  const prizePool  = totalPool - fee;
  // Read payout splits from SystemConfig; validate sum ≤ 1, fall back to 0.60/0.40
  const [split1Raw, split2Raw] = await Promise.all([
    getConfigValue<number>("game.dice_arena.payout_split_1st", 0.60),
    getConfigValue<number>("game.dice_arena.payout_split_2nd", 0.40),
  ]);
  const split1 = (typeof split1Raw === "number" && split1Raw > 0 && split1Raw < 1) ? split1Raw : 0.60;
  const split2 = (typeof split2Raw === "number" && split2Raw > 0 && split2Raw < 1) ? split2Raw : 0.40;
  const [s1, s2] = (split1 + split2 <= 1) ? [split1, split2] : [0.60, 0.40];
  const firstPayout  = parseFloat((prizePool * s1).toFixed(8));
  const secondPayout = parseFloat((prizePool * s2).toFixed(8));
  const resultData   = { rolls, first, second, totalPool, fee, firstPayout, secondPayout };
  state.resultData   = resultData;

  await db.$transaction(async (tx) => {
    await creditWallet(tx, first, "game", firstPayout);
    await writeLedgerEntry(tx, { userId: first, type: "game_win", toWallet: "game", amount: firstPayout,
      description: "Dice arena 1st place", referenceType: "game_round", metadata: { roundId: state.roundId, placement: 1 } });
    if (second !== first) {
      await creditWallet(tx, second, "game", secondPayout);
      await writeLedgerEntry(tx, { userId: second, type: "game_win", toWallet: "game", amount: secondPayout,
        description: "Dice arena 2nd place", referenceType: "game_round", metadata: { roundId: state.roundId, placement: 2 } });
    }
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
      const payout = pid === first ? firstPayout : pid === second ? secondPayout : 0;
      await recordGameResult({ tx, userId: pid, gameType: "dice_arena", wagered: stake, won: pid === first || pid === second, payout });
    }
  });
  state.status = "result";

  for (const pid of state.players) {
    const userFee = stake * feeRate;
    setImmediate(() => triggerGameFeeCommission({ userId: pid, userFee, isMultiGame: true, eventRefId: state.roundId }));
  }

  setTimeout(() => {
    state.status = "completed";
    const key = instanceKey(stake);
    arenaRounds.delete(key);
    db.diceRound.update({ where: { id: state.roundId }, data: { status: "completed" } }).catch(() => {});
  }, RESULT_MS);
}

const arenaTimers = new Set<string>();
function ensureArenaTicker(stake: number): void {
  const key = instanceKey(stake);
  if (arenaTimers.has(key)) return;
  arenaTimers.add(key);
  setInterval(async () => {
    const state = arenaRounds.get(key);
    if (!state || state.status !== "countdown") return;
    const elapsed   = Date.now() - (state.countdownStartedAt ?? Date.now());
    const remaining = COUNTDOWN_MS - elapsed;
    if (remaining <= LOCK_BEFORE_MS && state.status === "countdown") {
      state.status = "locked";
      await db.diceRound.update({ where: { id: state.roundId }, data: { status: "locked" } }).catch(() => {});
    }
    if (remaining <= 0) await settleArenaRound(stake, state).catch(() => {});
  }, 500);
}

export async function getArenaRound(stake: number) {
  const state = await getOrCreateArenaRound(stake);
  const timeRemaining = state.countdownStartedAt
    ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000))
    : null;
  return {
    roundId:        state.roundId, roundNumber: state.roundNumber, stake,
    status:         state.status, playerCount: state.players.length, maxPlayers: MAX_PLAYERS,
    canJoin:        ["open", "countdown"].includes(state.status) && state.players.length < MAX_PLAYERS,
    timeRemaining,
    resultData:     state.status === "result" || state.status === "completed" ? state.resultData : null,
    serverSeedHash: state.serverSeedHash,
  };
}

export async function joinArenaRound(userId: string, stake: number) {
  // Admin-configurable availability + stake checks
  const [gameEnabled, gameMaintenance, configuredStakes] = await Promise.all([
    getConfigValue<boolean>("game.dice_arena.enabled",     true),
    getConfigValue<boolean>("game.dice_arena.maintenance", false),
    getConfigValue<number[]>("game.dice_arena.stakes",     []),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error("Dice Arena is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error("Dice Arena is under maintenance"),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (configuredStakes.length > 0 && !configuredStakes.includes(stake))
    throw Object.assign(new Error(`Stake $${stake} is not available`), { statusCode: 400, code: "INVALID_STAKE" });

  ensureArenaTicker(stake);
  const state = await getOrCreateArenaRound(stake);
  if (!["open", "countdown"].includes(state.status)) throw Object.assign(new Error(`Round not open — ${state.status}`), { statusCode: 409, code: "ROUND_NOT_OPEN" });
  if (state.players.length >= MAX_PLAYERS) throw Object.assign(new Error("Round full"), { statusCode: 409, code: "ROUND_FULL" });

  // Synchronous pending guard — prevents same user from joining twice concurrently
  const pending = arenaPendingJoins.get(state.roundId) ?? new Set<string>();
  if (state.players.includes(userId) || pending.has(userId)) {
    throw Object.assign(new Error("Already joined this round"), { statusCode: 409, code: "ALREADY_JOINED" });
  }
  pending.add(userId);
  arenaPendingJoins.set(state.roundId, pending);

  try {
    await db.$transaction(async (tx) => {
      // DB-level duplicate guard via DiceRound.playerIds
      const dbRound = await tx.diceRound.findUnique({ where: { id: state.roundId }, select: { playerIds: true } });
      const existingIds: string[] = dbRound ? JSON.parse(dbRound.playerIds) : [];
      if (existingIds.includes(userId)) {
        throw Object.assign(new Error("Already joined this round"), { statusCode: 409, code: "ALREADY_JOINED" });
      }

      await debitWallet(tx, userId, "game", stake);
      await writeLedgerEntry(tx, { userId, type: "game_bet", fromWallet: "game", amount: stake,
        description: `Dice arena entry — stake ${stake}`, referenceType: "game_round",
        metadata: { roundId: state.roundId, stake } });

      const newIds = [...existingIds, userId];
      await tx.diceRound.update({ where: { id: state.roundId }, data: { playerIds: JSON.stringify(newIds) } });
    });

    state.players.push(userId);
  } finally {
    pending.delete(userId);
  }

  // Countdown starts on 3rd player (playerIds already updated in transaction above)
  if (state.players.length === MIN_TO_START && state.countdownStartedAt === null) {
    state.countdownStartedAt = Date.now();
    state.status = "countdown";
    await db.diceRound.update({ where: { id: state.roundId }, data: { status: "countdown", playerIds: JSON.stringify(state.players), countdownStartedAt: new Date() } });
  }
  // Note: playerIds written to DB inside the transaction above

  setImmediate(() => activateReferral(userId).catch(() => {}));
  return { roundId: state.roundId, stake, playerCount: state.players.length, maxPlayers: MAX_PLAYERS, status: state.status,
    timeRemaining: state.countdownStartedAt ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000)) : null };
}