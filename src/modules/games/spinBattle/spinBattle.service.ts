/**
 * Spin Battle — real-player lobby management.
 *
 * CORRECTIONS (Phase 3F Section E):
 *   - Real players only. No bots.
 *   - Countdown begins when the SECOND real player joins.
 *   - Countdown duration: 30s after 2nd player joins.
 *   - Betting closes 5s before round starts (locking phase).
 *   - Max 12 players per round.
 *   - Commission triggers on EVERY player's fee (win OR loss) — Section D.
 */
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveSpinWinner, generateVerificationId } from "../provablyFair";
import { checkRoomAccess } from "../../admin/games/admin.games.service";
import { db } from "../../../db";
import { debitWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { settleSingleWinnerInTx } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";

// Restored lobby bet ranges: A=$1–$20, B=$21–$50, C=$51–$120, D=$121–$500
export const SPIN_LOBBY_CONFIG: Record<string, { minBet: number; maxBet: number; maxPlayers: number }> = {
  A: { minBet: 1,   maxBet: 20,  maxPlayers: 12 },
  B: { minBet: 21,  maxBet: 50,  maxPlayers: 12 },
  C: { minBet: 51,  maxBet: 120, maxPlayers: 12 },
  D: { minBet: 121, maxBet: 500, maxPlayers: 12 },
};

// Tracks which lobbies have an active ticker (separate from SPIN_LOBBY_CONFIG which is pre-populated)
const activeSpinTickers = new Set<string>();

const COUNTDOWN_MS   = 30_000;   // starts when 2nd player joins
const LOCK_BEFORE_MS =  5_000;   // betting closes 5s before round start
const RESULT_MS      =  8_000;   // result display duration

interface SpinLobbyState {
  roundId:           string;
  roundNumber:       number;
  phase:             "waiting" | "countdown" | "locked" | "spinning" | "result" | "completed";
  players:           string[];
  countdownStartedAt:number | null;
  winnerId:          string | null;
  winnerPayout:      number | null;
  serverSeed:        string;
  serverSeedHash:    string;
}

const spinLobbyStates = new Map<string, SpinLobbyState>();
const spinRoundCounters: Record<string, number> = {};

// Per-lobby pending-join set — synchronous mutex for concurrent join calls.
// Because Node.js is single-threaded, marking pending before any await means
// no other callback can pass the duplicate check for the same userId.
const spinPendingJoins = new Map<string, Set<string>>();

async function ensureSpinLobby(lobbyId: string): Promise<SpinLobbyState> {
  if (spinLobbyStates.has(lobbyId)) return spinLobbyStates.get(lobbyId)!;

  // DB fallback: recover active round after cold start / server restart
  const active = await db.gameRound.findFirst({
    where: { gameType: "spin_battle", lobbyId, status: { in: ["waiting", "countdown", "locked", "spinning", "result"] } },
    orderBy: { roundNumber: "desc" },
  });
  if (active) {
    const bets = await db.gameBet.findMany({ where: { roundId: active.id } });
    const savedData   = active.resultData ? JSON.parse(active.resultData) : {};
    const savedStart  = savedData.countdownStartedAt ?? null;
    const recoveredSeed = active.serverSeed ?? generateServerSeed();
    const state: SpinLobbyState = {
      roundId:           active.id,
      roundNumber:       active.roundNumber,
      phase:             active.status as SpinLobbyState["phase"],
      players:           bets.map(b => b.userId),
      countdownStartedAt: savedStart,
      winnerId:          savedData.winner ?? null,
      winnerPayout:      savedData.winnerPayout ?? null,
      serverSeed:        recoveredSeed,
      serverSeedHash:    active.serverSeedHash ?? hashServerSeed(recoveredSeed),
    };
    spinLobbyStates.set(lobbyId, state);
    spinRoundCounters[lobbyId] = active.roundNumber;
    return state;
  }

  return startNewSpinRound(lobbyId);
}

async function startNewSpinRound(lobbyId: string): Promise<SpinLobbyState> {
  const roundNumber    = (spinRoundCounters[lobbyId] ?? 0) + 1;
  spinRoundCounters[lobbyId] = roundNumber;
  const serverSeed     = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const round = await db.gameRound.create({
    data: { gameType: "spin_battle", lobbyId, roundNumber, status: "waiting", serverSeed, serverSeedHash, verificationId: generateVerificationId("spin_battle") },
  });
  const state: SpinLobbyState = {
    roundId: round.id, roundNumber,
    phase: "waiting", players: [], countdownStartedAt: null, winnerId: null, winnerPayout: null,
    serverSeed, serverSeedHash,
  };
  spinLobbyStates.set(lobbyId, state);
  return state;
}

async function settleSpinRound(lobbyId: string, state: SpinLobbyState): Promise<void> {
  if (state.players.length === 0) return;

  // Derive provably-fair result before opening the transaction (pure computation, no DB writes)
  const sortedPlayerIds = [...state.players].sort();
  const clientSeed      = generateClientSeed(...sortedPlayerIds, state.roundId);
  const winnerId        = deriveSpinWinner(state.serverSeed, clientSeed, state.roundNumber, sortedPlayerIds);

  // Read bets and fee rate before the transaction (immutable once round is locked)
  const _dec = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? 0)));
  const bets = await db.gameBet.findMany({ where: { roundId: state.roundId, settled: false } });
  const totalPool    = bets.reduce((s, b) => s + _dec(b.amount), 0);
  const feeRate      = await getGameFeeRate("spin_battle");
  const fee          = totalPool * feeRate;
  const winnerPayout = totalPool - fee;
  const playerBets   = new Map<string, number>(bets.map(b => [b.userId, _dec(b.amount)]));
  const loserIds     = state.players.filter(id => id !== winnerId);

  // ONE atomic transaction: idempotency guard + payout + ledger + stats + round update + commission jobs.
  // If anything fails the entire settlement rolls back — no partial state possible.
  let settled = false;
  await db.$transaction(async (tx) => {
    // Idempotency guard: atomically transition locked → spinning.
    // A concurrent ticker call seeing count=0 means another call already committed — safe to skip.
    const guard = await tx.gameRound.updateMany({
      where: { id: state.roundId, status: "locked" },
      data:  { status: "spinning" },
    });
    if (guard.count === 0) return; // already settled by a concurrent call
    settled = true;

    // Winner payout, ledger entry, and game stats for all players (no nested tx)
    await settleSingleWinnerInTx(tx, {
      winnerId,
      loserIds,
      totalPool,
      platformFee: fee,
      winnerPayout,
      gameType:    "spin_battle",
      roundId:     state.roundId,
    });

    // Finalize round record
    await tx.gameRound.update({
      where: { id: state.roundId },
      data:  {
        status:     "result",
        resultData: JSON.stringify({ winner: winnerId, fee, winnerPayout, countdownStartedAt: state.countdownStartedAt }),
        settledAt:  new Date(),
        serverSeed: state.serverSeed,
        clientSeed,
        nonce:      state.roundNumber,
      },
    });

    // Commission jobs and bet settlement for every player — all atomic with the payout above
    const now = new Date();
    for (const bet of bets) {
      const isWinner  = bet.userId === winnerId;
      const playerBet = playerBets.get(bet.userId) ?? _dec(bet.amount);
      const userFee   = playerBet * feeRate;
      await tx.gameBet.update({
        where: { id: bet.id },
        data: {
          outcome:     isWinner ? "win" : "loss",
          payout:      isWinner ? winnerPayout : 0,
          platformFee: userFee,
          settled:     true,
          settledAt:   now,
        },
      });
      await createGameFeeJobInTx(tx, { userId: bet.userId, userFee, isMultiGame: true, eventRefId: state.roundId });
    }
  });

  if (!settled) return; // concurrent call already handled settlement

  // Update in-memory state only after the transaction has committed
  state.winnerId     = winnerId;
  state.winnerPayout = winnerPayout;
  state.phase        = "result";

  setTimeout(async () => {
    spinLobbyStates.delete(lobbyId);
    await db.gameRound.update({ where: { id: state.roundId }, data: { status: "completed" } }).catch(() => {});
    await startNewSpinRound(lobbyId);
  }, RESULT_MS);
}

async function tickSpinLobby(lobbyId: string): Promise<void> {
  const state = await ensureSpinLobby(lobbyId);
  if (state.phase !== "countdown" && state.phase !== "locked") return;

  const elapsed  = Date.now() - (state.countdownStartedAt ?? Date.now());
  const remaining = COUNTDOWN_MS - elapsed;

  if (remaining <= LOCK_BEFORE_MS && state.phase === "countdown") {
    // Lock betting 5s before round starts
    state.phase = "locked";
    await db.gameRound.update({ where: { id: state.roundId }, data: { status: "locked" } });
  }

  if (remaining <= 0) {
    await settleSpinRound(lobbyId, state);
  }
}

/** Register a lobby in the running engine — called at startup and when admin creates a new lobby. */
export async function registerSpinLobby(lobbyId: string, minBet: number, maxBet: number): Promise<void> {
  SPIN_LOBBY_CONFIG[lobbyId] = { minBet, maxBet, maxPlayers: 12 }; // always update config
  if (activeSpinTickers.has(lobbyId)) return; // ticker already running
  activeSpinTickers.add(lobbyId);
  setInterval(() => tickSpinLobby(lobbyId).catch(err => console.error(`[SpinBattle:${lobbyId}]`, err)), 500);
  console.log(`[SpinBattle] Lobby ${lobbyId} registered (min=$${minBet} max=$${maxBet})`);
}

export async function startSpinBattleLobbies(): Promise<void> {
  const configuredIds = await getConfigValue<string[]>(
    "game.spin_battle.lobby_ids",
    Object.keys(SPIN_LOBBY_CONFIG),
  );
  for (const lobbyId of configuredIds) {
    const minBet = await getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.min_bet`, SPIN_LOBBY_CONFIG[lobbyId]?.minBet ?? 1);
    const maxBet = await getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.max_bet`, SPIN_LOBBY_CONFIG[lobbyId]?.maxBet ?? 100);
    await registerSpinLobby(lobbyId, minBet, maxBet);
  }
  console.log(`[SpinBattle] Lobbies started: ${configuredIds.join(", ")} — real players only, countdown on 2nd join`);
}

// ── Build enriched lobby snapshot (shared by both endpoints) ──────────────────
async function buildLobbySnapshot(lobbyId: string, state: SpinLobbyState, userId?: string) {
  const cfg       = SPIN_LOBBY_CONFIG[lobbyId];
  const remaining = state.countdownStartedAt
    ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000))
    : null;

  // Fetch usernames for all players in the current round
  const profiles = state.players.length > 0
    ? await db.userProfile.findMany({ where: { userId: { in: state.players } }, select: { userId: true, username: true } })
    : [];
  const usernameMap = new Map(profiles.map(p => [p.userId, p.username as string | null]));

  // Fetch winner username if applicable
  let winnerUsername: string | null = null;
  if (state.winnerId) {
    const mapVal = usernameMap.get(state.winnerId);
    winnerUsername = typeof mapVal === "string" ? mapVal : null;
    if (!winnerUsername) {
      const wp = await db.userProfile.findUnique({ where: { userId: state.winnerId }, select: { username: true } });
      winnerUsername = typeof wp?.username === "string" ? wp.username : null;
    }
  }

  // Last 10 completed rounds for recent winners display
  const recentRounds = await db.gameRound.findMany({
    where:   { gameType: "spin_battle", lobbyId, status: "completed", resultData: { not: null } },
    orderBy: { roundNumber: "desc" },
    take:    10,
    select:  { roundNumber: true, resultData: true, settledAt: true },
  });
  const recentWinners = await Promise.all(
    recentRounds.map(async r => {
      const data = r.resultData ? JSON.parse(r.resultData) : {};
      const wId  = data.winner ?? null;
      let   wUsername: string | null = null;
      if (wId) {
        const wp = await db.userProfile.findUnique({ where: { userId: wId }, select: { username: true } });
        wUsername = wp?.username ?? null;
      }
      return {
        roundNumber:     r.roundNumber,
        winnerId:        wId,
        winnerUsername:  wUsername,
        winnerPayout:    data.winnerPayout ?? 0,
        timestamp:       r.settledAt?.toISOString() ?? new Date().toISOString(),
      };
    })
  );

  // Compute live pool from actual DB bets (range-based)
  const _d = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? 0)));
  let livePool = 0;
  let myBetAmount: number | null = null;
  if (state.players.length > 0) {
    const liveBets = await db.gameBet.findMany({ where: { roundId: state.roundId } });
    livePool = liveBets.reduce((s, b) => s + _d(b.amount), 0);
    if (userId) {
      const mb = liveBets.find(b => b.userId === userId);
      myBetAmount = mb ? _d(mb.amount) : null;
    }
  }

  return {
    lobbyId,
    roundId:       state.roundId,
    roundNumber:   state.roundNumber,
    phase:         state.phase,
    playerCount:   state.players.length,
    maxPlayers:    cfg.maxPlayers,
    minBet:        cfg.minBet,
    maxBet:        cfg.maxBet,
    totalPool:     livePool,
    timeRemaining: remaining,
    winnerId:      state.winnerId,
    winnerUsername,
    winnerPayout:  state.winnerPayout,
    canJoin:       ["waiting","countdown"].includes(state.phase) && state.players.length < cfg.maxPlayers,
    players:       state.players.map((uid, i) => ({
      userId:   uid,
      username: usernameMap.get(uid) ?? `Player ${i + 1}`,
      index:    i,
    })),
    myBet: userId ? { inRound: state.players.includes(userId), amount: myBetAmount } : null,
    recentWinners,
    serverSeedHash: state.serverSeedHash,
  };
}

export async function getSpinLobbyStates() {
  const result: Record<string, any> = {};
  for (const lobbyId of Object.keys(SPIN_LOBBY_CONFIG)) {
    const state = await ensureSpinLobby(lobbyId);
    result[lobbyId] = await buildLobbySnapshot(lobbyId, state);
  }
  return result;
}

export async function getSpinLobbyState(lobbyId: string, userId: string) {
  const cfg = SPIN_LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 404, code: "NOT_FOUND" });
  const state = await ensureSpinLobby(lobbyId);
  return buildLobbySnapshot(lobbyId, state, userId);
}

export async function joinSpinLobby(userId: string, lobbyId: string, betAmount: number) {
  const cfg = SPIN_LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });

  // Admin-configurable availability checks
  const [gameEnabled, gameMaintenance, lobbyEnabled, cfgMinBet, cfgMaxBet] = await Promise.all([
    getConfigValue<boolean>("game.spin_battle.enabled",              true),
    getConfigValue<boolean>("game.spin_battle.maintenance",          false),
    getConfigValue<boolean>(`game.spin_battle.lobby.${lobbyId}.enabled`, true),
    getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.min_bet`, cfg.minBet),
    getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.max_bet`, cfg.maxBet),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error("Spin Battle is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error("Spin Battle is under maintenance"),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (!lobbyEnabled)   throw Object.assign(new Error(`Lobby ${lobbyId} is currently unavailable`), { statusCode: 503, code: "LOBBY_DISABLED" });

  await checkRoomAccess(userId, "spin_battle", lobbyId);

  if (betAmount < cfgMinBet || betAmount > cfgMaxBet) {
    throw Object.assign(
      new Error(`Bet must be $${cfgMinBet}–$${cfgMaxBet} for Lobby ${lobbyId}`),
      { statusCode: 400, code: "INVALID_BET_AMOUNT" }
    );
  }

  const state = await ensureSpinLobby(lobbyId);

  if (!["waiting", "countdown"].includes(state.phase)) {
    throw Object.assign(new Error(`Lobby ${lobbyId} is not accepting players — phase: ${state.phase}`), { statusCode: 409, code: "LOBBY_NOT_OPEN" });
  }
  if (state.players.length >= cfg.maxPlayers) {
    throw Object.assign(new Error("Lobby is full"), { statusCode: 409, code: "LOBBY_FULL" });
  }
  if (state.phase === "locked") {
    throw Object.assign(new Error("Betting is closed — wait for the next round"), { statusCode: 409, code: "BETTING_CLOSED" });
  }

  // Synchronous duplicate guard — checked before any await so concurrent requests are blocked.
  // gameBet creation inside the transaction is the DB-level guard that makes this permanent.
  const pending = spinPendingJoins.get(lobbyId) ?? new Set<string>();
  if (state.players.includes(userId) || pending.has(userId)) {
    throw Object.assign(new Error("You are already in this lobby"), { statusCode: 409, code: "ALREADY_JOINED" });
  }
  pending.add(userId);
  spinPendingJoins.set(lobbyId, pending);

  try {
    await db.$transaction(async (tx) => {
      // DB-level duplicate guard: gameBet already exists ⟹ user already joined
      const existingBet = await tx.gameBet.findFirst({ where: { roundId: state.roundId, userId } });
      if (existingBet) throw Object.assign(new Error("You are already in this lobby"), { statusCode: 409, code: "ALREADY_JOINED" });

      await debitWallet(tx, userId, "game", betAmount);
      const newBet = await tx.gameBet.create({ data: { roundId: state.roundId, userId, amount: betAmount, betData: JSON.stringify({ lobby: lobbyId, bet: betAmount }) } });
      await writeLedgerEntry(tx, {
        userId, type: "game_bet", fromWallet: "game", amount: betAmount,
        description: "Spin battle bet", referenceId: newBet.id, referenceType: "game_bet",
        metadata: { lobbyId, roundId: state.roundId },
      });
    });

    state.players.push(userId);
  } finally {
    pending.delete(userId);
  }

  // SECTION E: Countdown begins when the SECOND player joins
  if (state.players.length === 2 && state.countdownStartedAt === null) {
    const now = Date.now();
    state.countdownStartedAt = now;
    state.phase = "countdown";
    // Persist countdownStartedAt to DB so timer survives server restart
    await db.gameRound.update({
      where: { id: state.roundId },
      data:  { status: "countdown", resultData: JSON.stringify({ countdownStartedAt: now }) },
    });
    console.log(`[SpinBattle:${lobbyId}] Countdown started — 2 players joined (round ${state.roundNumber})`);
  }

  return {
    lobbyId,
    roundId:     state.roundId,
    betAmount,
    minBet:      cfg.minBet,
    maxBet:      cfg.maxBet,
    playerCount: state.players.length,
    maxPlayers:  cfg.maxPlayers,
    phase:       state.phase,
    timeRemaining: state.countdownStartedAt
      ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000))
      : null,
  };
}
