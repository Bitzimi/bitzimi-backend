/**
 * Color Game — server-authoritative round management.
 *
 * CORRECTIONS (Phase 3F Section C):
 *   - If betting closes with only one side having bets → VOID round
 *   - Refund 100% of all stakes (no platform fee retained)
 *   - Status: cancelled_insufficient_opposition
 *   - No affiliate commission on void rounds
 *   - Platform does not participate in rounds to balance sides
 *
 * CORRECTIONS (Phase 3F Section D):
 *   - Commission fires on BOTH wins AND losses (fee-based)
 *   - Each VIP player's fee contribution = bet × 10%
 *   - Commission NOT fired on void/cancelled rounds
 *
 * Round lifecycle: WAITING (90s) → SPINNING (6s) → RESULT (5s) → new WAITING
 */
import { db } from "../../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { recordGameResult } from "../settlement";
import { triggerGameFeeCommission } from "../../affiliates/commissions";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveColorResult, generateVerificationId } from "../provablyFair";
import { checkRoomAccess } from "../../admin/games/admin.games.service";

export const LOBBY_CONFIG: Record<string, { minBet: number; maxBet: number }> = {
  A: { minBet: 1,    maxBet: 20    },
  B: { minBet: 21,   maxBet: 100   },
  C: { minBet: 101,  maxBet: 1000  },
  D: { minBet: 1001, maxBet: 5000  },
};

// Tracks which lobbies have an active ticker (separate from LOBBY_CONFIG which is pre-populated)
const activeColorTickers = new Set<string>();

const WAITING_DURATION_MS  = 90_000;
const SPINNING_DURATION_MS =  6_000;
const RESULT_DURATION_MS   =  5_000;

interface LobbyState {
  roundId:          string;
  roundNumber:      number;
  dailyRoundNumber: number;
  phase:            "waiting" | "spinning" | "result";
  phaseStartedAt:   number;
  result:           "red" | "blue" | null;
  redTotal:         number;
  blueTotal:        number;
  voided:           boolean;
  serverSeed:       string;
  serverSeedHash:   string;
  clientSeed:       string | null;
}

const lobbyStates = new Map<string, LobbyState>();
const roundCounters: Record<string, number> = {};

async function ensureLobby(lobbyId: string): Promise<LobbyState> {
  if (lobbyStates.has(lobbyId)) return lobbyStates.get(lobbyId)!;
  const active = await db.gameRound.findFirst({
    where: { gameType: "color_game", lobbyId, status: { in: ["waiting", "spinning", "result"] } },
    orderBy: { roundNumber: "desc" },
  });
  if (active) {
    const bets = await db.gameBet.findMany({ where: { roundId: active.id } });
    const savedSeed = active.serverSeed ?? generateServerSeed();
    const state: LobbyState = {
      roundId: active.id, roundNumber: active.roundNumber,
      dailyRoundNumber: active.dailyRoundNumber ?? active.roundNumber,
      phase: active.status as LobbyState["phase"], phaseStartedAt: Date.now() - 1000,
      result: active.resultData ? JSON.parse(active.resultData).result : null,
      redTotal:  bets.filter(b => JSON.parse(b.betData).team === "red").reduce((s, b)  => s + b.amount, 0),
      blueTotal: bets.filter(b => JSON.parse(b.betData).team === "blue").reduce((s, b) => s + b.amount, 0),
      voided: false,
      serverSeed: savedSeed,
      serverSeedHash: active.serverSeedHash ?? hashServerSeed(savedSeed),
      clientSeed: active.clientSeed ?? null,
    };
    lobbyStates.set(lobbyId, state);
    roundCounters[lobbyId] = active.roundNumber;
    return state;
  }
  return startNewRound(lobbyId);
}

async function startNewRound(lobbyId: string): Promise<LobbyState> {
  const roundNumber = (roundCounters[lobbyId] ?? 0) + 1;
  roundCounters[lobbyId] = roundNumber;

  // Daily round number: how many rounds for this lobby have started today (UTC)
  const startOfDayUTC = new Date();
  startOfDayUTC.setUTCHours(0, 0, 0, 0);
  const todayCount = await db.gameRound.count({
    where: { gameType: "color_game", lobbyId, startedAt: { gte: startOfDayUTC } },
  });
  const dailyRoundNumber = todayCount + 1;

  const serverSeed     = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const round = await db.gameRound.create({
    data: { gameType: "color_game", lobbyId, roundNumber, status: "waiting", serverSeed, serverSeedHash, dailyRoundNumber, verificationId: generateVerificationId("color_game") },
  });
  const state: LobbyState = {
    roundId: round.id, roundNumber, dailyRoundNumber,
    phase: "waiting", phaseStartedAt: Date.now(),
    result: null, redTotal: 0, blueTotal: 0, voided: false,
    serverSeed, serverSeedHash, clientSeed: null,
  };
  lobbyStates.set(lobbyId, state);
  return state;
}

async function settleRound(lobbyId: string, state: LobbyState): Promise<void> {
  const { roundId, result, redTotal, blueTotal } = state;
  if (!result) return;

  const bets = await db.gameBet.findMany({ where: { roundId, settled: false } });
  if (bets.length === 0) return;

  // ── SECTION C: Void round if only one side has bets ──────────────────────
  const hasRedBets  = redTotal > 0;
  const hasBlueBets = blueTotal > 0;

  if (!hasRedBets || !hasBlueBets) {
    // VOID: refund 100% of all stakes, no fee retained, no commission
    state.voided = true;
    await db.$transaction(async (tx) => {
      for (const bet of bets) {
        await creditWallet(tx, bet.userId, "game", bet.amount);
        await writeLedgerEntry(tx, {
          userId: bet.userId, type: "transfer", toWallet: "game", amount: bet.amount,
          description: "Color game void — full refund",
          referenceId: bet.id, referenceType: "game_bet",
        });
        await tx.gameBet.update({ where: { id: bet.id }, data: { outcome: "draw", payout: bet.amount, platformFee: 0, settled: true, settledAt: new Date() } });
      }
    });
    await db.gameRound.update({
      where: { id: roundId },
      data:  { status: "cancelled_insufficient_opposition", settledAt: new Date() },
    });
    return;
    // NO commission fired — platform retained no fee
  }

  // ── Normal settlement ─────────────────────────────────────────────────────
  const winningTeam  = result;
  const winningTotal = winningTeam === "red" ? redTotal : blueTotal;
  const losingTotal  = winningTeam === "red" ? blueTotal : redTotal;
  const feeRate      = await getGameFeeRate("color_game");
  const fee          = losingTotal * feeRate;

  await db.$transaction(async (tx) => {
    for (const bet of bets) {
      const betTeam  = JSON.parse(bet.betData).team;
      const isWinner = betTeam === winningTeam;
      let   payout   = 0;

      if (isWinner) {
        const winProfit = (losingTotal - fee) * (bet.amount / winningTotal);
        payout = bet.amount + winProfit;
        await creditWallet(tx, bet.userId, "game", payout);
        await writeLedgerEntry(tx, {
          userId: bet.userId, type: "game_win", toWallet: "game", amount: payout,
          description: `Color game win — team ${winningTeam}`,
          referenceId: bet.id, referenceType: "game_bet", metadata: { team: winningTeam },
        });
      }

      const userFee = bet.amount * feeRate; // each player's fee contribution
      await tx.gameBet.update({
        where: { id: bet.id },
        data: {
          outcome:     isWinner ? "win" : "loss",
          payout:      isWinner ? payout : 0,
          platformFee: userFee,  // fee applies to ALL bets (losers fund the fee pool)
          settled:     true,
          settledAt:   new Date(),
        },
      });
      await recordGameResult({ tx, userId: bet.userId, gameType: "color_game", wagered: bet.amount, won: isWinner, payout: isWinner ? payout : 0 });
    }
  });

  // ── Section D: Commission on EVERY bet (win OR loss), using each player's fee ──
  for (const bet of bets) {
    const userFee = bet.amount * feeRate;
    setImmediate(() =>
      triggerGameFeeCommission({ userId: bet.userId, userFee, isMultiGame: true, eventRefId: roundId })
    );
  }
}

async function tickLobby(lobbyId: string): Promise<void> {
  const state   = await ensureLobby(lobbyId);
  const elapsed = Date.now() - state.phaseStartedAt;

  if (state.phase === "waiting" && elapsed >= WAITING_DURATION_MS) {
    state.phase = "spinning";
    state.phaseStartedAt = Date.now();

    // Derive clientSeed from all bettors in this round (deterministic, public data)
    const bettors = (await db.gameBet.findMany({ where: { roundId: state.roundId }, select: { userId: true } })) as Array<{ userId: string }>;
    const sortedIds = [...new Set(bettors.map(b => b.userId))].sort();
    const clientSeed = generateClientSeed(...sortedIds, state.roundId);
    state.clientSeed = clientSeed;

    // Use PF to determine result — nonce = permanent roundNumber
    state.result = deriveColorResult(state.serverSeed, clientSeed, state.roundNumber);

    await db.gameRound.update({
      where: { id: state.roundId },
      data:  {
        status:     "spinning",
        clientSeed,
        nonce:      state.roundNumber,
        resultData: JSON.stringify({ result: state.result }),
      },
    });
  } else if (state.phase === "spinning" && elapsed >= SPINNING_DURATION_MS) {
    state.phase = "result";
    state.phaseStartedAt = Date.now();
    await db.gameRound.update({ where: { id: state.roundId }, data: { status: "result" } });
    await settleRound(lobbyId, state);
  } else if (state.phase === "result" && elapsed >= RESULT_DURATION_MS) {
    lobbyStates.delete(lobbyId);
    const finalStatus = state.voided ? "cancelled_insufficient_opposition" : "completed";
    // Reveal serverSeed on round completion so players can verify
    await db.gameRound.update({
      where: { id: state.roundId },
      data:  { status: finalStatus, settledAt: new Date(), serverSeed: state.serverSeed },
    }).catch(() => {});
    await startNewRound(lobbyId);
  }
}

/** Register a lobby in the running engine — called at startup and when admin creates a new lobby. */
export async function registerColorLobby(lobbyId: string, minBet: number, maxBet: number): Promise<void> {
  LOBBY_CONFIG[lobbyId] = { minBet, maxBet }; // always update config
  if (activeColorTickers.has(lobbyId)) return; // ticker already running
  activeColorTickers.add(lobbyId);
  setInterval(() => tickLobby(lobbyId).catch(err => console.error(`[ColorGame:${lobbyId}]`, err)), 1000);
  console.log(`[ColorGame] Lobby ${lobbyId} registered (min=$${minBet} max=$${maxBet})`);
}

export async function startColorGameLobbies(): Promise<void> {
  const configuredIds = await getConfigValue<string[]>(
    "game.color_game.lobby_ids",
    Object.keys(LOBBY_CONFIG),
  );
  for (const lobbyId of configuredIds) {
    const minBet = await getConfigValue<number>(`game.color_game.lobby.${lobbyId}.min_bet`, LOBBY_CONFIG[lobbyId]?.minBet ?? 1);
    const maxBet = await getConfigValue<number>(`game.color_game.lobby.${lobbyId}.max_bet`, LOBBY_CONFIG[lobbyId]?.maxBet ?? 100);
    await registerColorLobby(lobbyId, minBet, maxBet);
  }
  console.log(`[ColorGame] Lobbies started: ${configuredIds.join(", ")} — void on single-sided rounds`);
}

export async function getAllLobbyStates() {
  const states: Record<string, any> = {};
  for (const lobbyId of Object.keys(LOBBY_CONFIG)) {
    states[lobbyId] = await getLobbyState(lobbyId);
  }
  return states;
}

export async function getLobbyState(lobbyId: string, userId?: string) {
  const state   = await ensureLobby(lobbyId);
  const elapsed = Date.now() - state.phaseStartedAt;
  const cfg     = LOBBY_CONFIG[lobbyId];

  // Fetch current round bets for live feed + player counts + user's own bet
  const currentBets = await db.gameBet.findMany({
    where:   { roundId: state.roundId },
    include: { user: { include: { profile: { select: { username: true } } } } },
    orderBy: { placedAt: "desc" },
    take:    40,
  });

  const redBets  = currentBets.filter(b => JSON.parse(b.betData).team === "red");
  const blueBets = currentBets.filter(b => JSON.parse(b.betData).team === "blue");

  // User's bet for this round (includes payout once settled)
  let myBet: { team: string; amount: number; outcome: string | null; payout: number | null } | null = null;
  if (userId) {
    const bet = currentBets.find(b => b.userId === userId);
    if (bet) {
      myBet = {
        team:    JSON.parse(bet.betData).team,
        amount:  bet.amount,
        outcome: bet.outcome,          // "win" | "loss" | "draw" | null (null = not settled yet)
        payout:  bet.payout ?? null,
      };
    }
  }

  // Last 10 completed rounds for history display
  const historyRows = await db.gameRound.findMany({
    where:   { gameType: "color_game", lobbyId, status: "completed" },
    orderBy: { roundNumber: "desc" },
    take:    10,
    select:  { roundNumber: true, resultData: true, settledAt: true },
  });
  const history = historyRows
    .map(r => ({
      roundNumber: r.roundNumber,
      result:      r.resultData ? (JSON.parse(r.resultData) as { result: string }).result : null,
      timestamp:   r.settledAt?.toISOString() ?? new Date().toISOString(),
    }))
    .filter(r => r.result !== null);

  return {
    lobbyId,
    roundId:          state.roundId,
    roundNumber:      state.roundNumber,
    dailyRoundNumber: state.dailyRoundNumber,
    serverSeedHash:   state.serverSeedHash,
    phase:            state.phase,
    timeRemaining: Math.max(0, Math.ceil(
      (state.phase === "waiting"  ? WAITING_DURATION_MS  :
       state.phase === "spinning" ? SPINNING_DURATION_MS : RESULT_DURATION_MS) / 1000 - elapsed / 1000
    )),
    result:     state.phase === "result" ? state.result : null,
    voided:     state.voided,
    redTotal:   state.redTotal,
    blueTotal:  state.blueTotal,
    redPlayers: redBets.length,
    bluePlayers: blueBets.length,
    minBet:     cfg.minBet,
    maxBet:     cfg.maxBet,
    currentBets: currentBets.slice(0, 20).map(b => ({
      id:       b.id,
      username: b.user.profile?.username ?? "Player",
      amount:   b.amount,
      team:     JSON.parse(b.betData).team as "red" | "blue",
    })),
    history,
    myBet,
  };
}

export async function placeBet(userId: string, lobbyId: string, team: "red" | "blue", amount: number) {
  const cfg = LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });

  // Admin-configurable game/lobby availability checks
  const [gameEnabled, gameMaintenance, lobbyEnabled, cfgMinBet, cfgMaxBet] = await Promise.all([
    getConfigValue<boolean>("game.color_game.enabled",              true),
    getConfigValue<boolean>("game.color_game.maintenance",          false),
    getConfigValue<boolean>(`game.color_game.lobby.${lobbyId}.enabled`, true),
    getConfigValue<number>(`game.color_game.lobby.${lobbyId}.min_bet`, cfg.minBet),
    getConfigValue<number>(`game.color_game.lobby.${lobbyId}.max_bet`, cfg.maxBet),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error("Color Prediction is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error("Color Prediction is under maintenance"),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (!lobbyEnabled)   throw Object.assign(new Error(`Lobby ${lobbyId} is currently unavailable`), { statusCode: 503, code: "LOBBY_DISABLED" });

  await checkRoomAccess(userId, "color_game", lobbyId);

  if (amount < cfgMinBet || amount > cfgMaxBet) {
    throw Object.assign(new Error(`Bet must be $${cfgMinBet}–$${cfgMaxBet} for lobby ${lobbyId}`), { statusCode: 400, code: "INVALID_BET_AMOUNT" });
  }

  const state = await ensureLobby(lobbyId);
  if (state.phase !== "waiting") {
    throw Object.assign(new Error(`Lobby ${lobbyId} not accepting bets — phase: ${state.phase}`), { statusCode: 409, code: "BETTING_CLOSED" });
  }

  // Bet existence check + wallet deduction in one atomic transaction
  // (prevents race condition where two concurrent requests both pass the check)
  await db.$transaction(async (tx) => {
    const existingBet = await tx.gameBet.findFirst({ where: { roundId: state.roundId, userId } });
    if (existingBet) throw Object.assign(new Error("You already placed a bet this round"), { statusCode: 409, code: "BET_ALREADY_PLACED" });

    await debitWallet(tx, userId, "game", amount);
    const newBet = await tx.gameBet.create({ data: { roundId: state.roundId, userId, amount, betData: JSON.stringify({ team }) } });
    await writeLedgerEntry(tx, {
      userId, type: "game_bet", fromWallet: "game", amount,
      description: `Color game bet — ${team}`,
      referenceId: newBet.id, referenceType: "game_bet", metadata: { team, roundId: state.roundId },
    });
  });

  if (team === "red") state.redTotal += amount;
  else state.blueTotal += amount;

  return { roundId: state.roundId, roundNumber: state.roundNumber, team, amount };
}
