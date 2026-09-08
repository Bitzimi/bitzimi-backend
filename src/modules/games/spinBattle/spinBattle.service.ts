import { generateServerSeed, hashServerSeed, generateClientSeed, deriveSpinWinner, generateVerificationId } from "../provablyFair";
import { checkRoomAccess } from "../../admin/games/admin.games.service";
import { db } from "../../../db";
import { debitWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { settleSingleWinnerInTx } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";

export const SPIN_LOBBY_CONFIG: Record<string, { minBet: number; maxBet: number; maxPlayers: number }> = {
  A: { minBet: 1, maxBet: 20, maxPlayers: 12 },
  B: { minBet: 21, maxBet: 50, maxPlayers: 12 },
  C: { minBet: 51, maxBet: 120, maxPlayers: 12 },
  D: { minBet: 121, maxBet: 500, maxPlayers: 12 },
};

const COUNTDOWN_MS = 30_000;
const LOCK_BEFORE_MS = 5_000;
const RESULT_MS = 8_000;
const activeSpinTickers = new Set<string>();

interface SpinLobbyState {
  roundId: string;
  roundNumber: number;
  phase: "waiting" | "countdown" | "locked" | "spinning" | "result" | "completed";
  players: string[];
  countdownStartedAt: number | null;
  winnerId: string | null;
  winnerPayout: number | null;
  serverSeed: string;
  serverSeedHash: string;
}

function decodeResultData(raw: string | null): any {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function loadRound(lobbyId: string): Promise<SpinLobbyState | null> {
  const round = await db.gameRound.findFirst({
    where: { gameType: "spin_battle", lobbyId, status: { in: ["waiting", "countdown", "locked", "spinning", "result"] } },
    orderBy: { roundNumber: "desc" },
  });
  if (!round) return null;
  const bets = await db.gameBet.findMany({ where: { roundId: round.id }, select: { userId: true } });
  const data = decodeResultData(round.resultData);
  return {
    roundId: round.id,
    roundNumber: round.roundNumber,
    phase: round.status as SpinLobbyState["phase"],
    players: bets.map(b => b.userId),
    countdownStartedAt: data.countdownStartedAt ?? null,
    winnerId: round.status === "result" ? (data.winner ?? null) : null,
    winnerPayout: round.status === "result" ? (data.winnerPayout ?? null) : null,
    serverSeed: round.serverSeed ?? "",
    serverSeedHash: round.serverSeedHash ?? "",
  };
}

async function createRound(lobbyId: string): Promise<SpinLobbyState> {
  const existing = await loadRound(lobbyId);
  if (existing) return existing;
  const last = await db.gameRound.findFirst({ where: { gameType: "spin_battle", lobbyId }, orderBy: { roundNumber: "desc" }, select: { roundNumber: true } });
  const roundNumber = (last?.roundNumber ?? 0) + 1;
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  try {
    await db.gameRound.create({ data: { gameType: "spin_battle", lobbyId, roundNumber, status: "waiting", serverSeed, serverSeedHash, verificationId: generateVerificationId("spin_battle") } });
  } catch {
    const recovered = await loadRound(lobbyId);
    if (recovered) return recovered;
    throw new Error("Unable to create Spin Battle round");
  }
  return (await loadRound(lobbyId))!;
}

async function ensureRound(lobbyId: string): Promise<SpinLobbyState> {
  return (await loadRound(lobbyId)) ?? createRound(lobbyId);
}

async function startSpinRound(lobbyId: string, roundId: string): Promise<void> {
  const bets = await db.gameBet.findMany({ where: { roundId, settled: false } });
  if (!bets.length) return;
  const sortedPlayerIds = [...new Set(bets.map(b => b.userId))].sort();
  const playerWeights: Record<string, number> = Object.fromEntries(bets.map(b => [b.userId, Number(b.amount)]));
  const clientSeed = generateClientSeed(...sortedPlayerIds.map(id => `${id}:${playerWeights[id]}`), roundId);
  const round = await db.gameRound.findUnique({ where: { id: roundId }, select: { roundNumber: true, serverSeed: true, serverSeedHash: true, status: true } });
  if (!round || !round.serverSeed || !round.serverSeedHash) return;
  const winnerId = deriveSpinWinner(round.serverSeed, clientSeed, round.roundNumber, sortedPlayerIds, playerWeights);
  const totalPool = bets.reduce((sum, b) => sum + Number(b.amount), 0);
  const feeRate = await getGameFeeRate("spin_battle");
  const fee = totalPool * feeRate;
  const winnerPayout = totalPool - fee;
  const resultData = { winner: winnerId, fee, feeRate, winnerPayout, playerBets: playerWeights, playerIds: sortedPlayerIds, roundId, spinStartedAt: Date.now() };
  await db.$transaction(async tx => {
    const guard = await tx.gameRound.updateMany({ where: { id: roundId, status: { in: ["locked", "countdown"] } }, data: { status: "spinning", resultData: JSON.stringify(resultData), clientSeed, nonce: round.roundNumber } });
    if (!guard.count) return;
  });
}

async function finishSpinRound(lobbyId: string, roundId: string): Promise<void> {
  const round = await db.gameRound.findUnique({ where: { id: roundId }, select: { roundNumber: true, serverSeed: true, serverSeedHash: true, status: true, resultData: true, clientSeed: true } });
  if (!round || round.status !== "spinning" || !round.serverSeed || !round.serverSeedHash) return;
  const data = decodeResultData(round.resultData);
  const spinStartedAt = Number(data.spinStartedAt ?? 0);
  if (!spinStartedAt || Date.now() - spinStartedAt < 5_000) return;
  const bets = await db.gameBet.findMany({ where: { roundId, settled: false } });
  if (!bets.length) return;
  const playerIds = Array.isArray(data.playerIds) ? data.playerIds : [...new Set(bets.map(b => b.userId))].sort();
  const winnerId = String(data.winner ?? "");
  if (!winnerId || !playerIds.includes(winnerId)) return;
  const totalPool = bets.reduce((sum,b)=>sum+Number(b.amount),0);
  const feeRate = Number(data.feeRate ?? await getGameFeeRate("spin_battle"));
  const fee = totalPool * feeRate;
  const winnerPayout = totalPool - fee;
  const loserIds = playerIds.filter(id=>id!==winnerId);
  await db.$transaction(async tx => {
    const guard = await tx.gameRound.updateMany({ where: { id: roundId, status: "spinning" }, data: { status: "result", resultData: JSON.stringify({ ...data, fee, feeRate, winnerPayout, playerBets: Object.fromEntries(bets.map(b=>[b.userId,Number(b.amount)])), playerIds, roundId }), settledAt: new Date(), clientSeed: round.clientSeed ?? undefined, nonce: round.roundNumber, serverSeed: round.serverSeed } });
    if (!guard.count) return;
    await settleSingleWinnerInTx(tx,{winnerId,loserIds,totalPool,platformFee:fee,winnerPayout,gameType:"spin_battle",roundId});
    const now=new Date();
    for(const bet of bets){const amount=Number(bet.amount);const userFee=amount*feeRate;await tx.gameBet.update({where:{id:bet.id},data:{outcome:bet.userId===winnerId?"win":"loss",payout:bet.userId===winnerId?winnerPayout:0,platformFee:userFee,settled:true,settledAt:now}});await createGameFeeJobInTx(tx,{userId:bet.userId,userFee,isMultiGame:true,eventRefId:roundId});}
  });
}

async function tickSpinLobby(lobbyId: string): Promise<void> {
  let state = await ensureRound(lobbyId);
  const now = Date.now();

  if (state.phase === "waiting") {
    if (state.players.length >= 2) {
      const countdownStartedAt = now;
      const updated = await db.gameRound.updateMany({ where: { id: state.roundId, status: "waiting" }, data: { status: "countdown", resultData: JSON.stringify({ countdownStartedAt }) } });
      if (updated.count) state = await ensureRound(lobbyId);
    }
    return;
  }

  if (state.phase === "countdown" || state.phase === "locked") {
    const started = state.countdownStartedAt ?? now;
    const remaining = COUNTDOWN_MS - (now - started);
    if (remaining <= LOCK_BEFORE_MS && state.phase === "countdown") {
      await db.gameRound.updateMany({ where: { id: state.roundId, status: "countdown" }, data: { status: "locked" } });
    }
    if (remaining <= 0) await startSpinRound(lobbyId, state.roundId);
    return;
  }

  if (state.phase === "spinning") {
    await finishSpinRound(lobbyId, state.roundId);
    return;
  }

  if (state.phase === "result") {
    const round = await db.gameRound.findUnique({ where: { id: state.roundId }, select: { settledAt: true } });
    if (round?.settledAt && now - round.settledAt.getTime() >= RESULT_MS) {
      await db.gameRound.updateMany({ where: { id: state.roundId, status: "result" }, data: { status: "completed" } });
      await createRound(lobbyId);
    }
  }
}

export async function registerSpinLobby(lobbyId: string, minBet: number, maxBet: number): Promise<void> {
  SPIN_LOBBY_CONFIG[lobbyId] = { minBet, maxBet, maxPlayers: 12 };
  if (activeSpinTickers.has(lobbyId)) return;
  activeSpinTickers.add(lobbyId);
  await ensureRound(lobbyId);
  setInterval(() => tickSpinLobby(lobbyId).catch(err => console.error(`[SpinBattle:${lobbyId}]`, err)), 500);
}

export async function startSpinBattleLobbies(): Promise<void> {
  const configuredIds = await getConfigValue<string[]>("game.spin_battle.lobby_ids", Object.keys(SPIN_LOBBY_CONFIG));
  for (const lobbyId of configuredIds) {
    const minBet = await getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.min_bet`, SPIN_LOBBY_CONFIG[lobbyId]?.minBet ?? 1);
    const maxBet = await getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.max_bet`, SPIN_LOBBY_CONFIG[lobbyId]?.maxBet ?? 100);
    await registerSpinLobby(lobbyId, minBet, maxBet);
  }
}

async function buildLobbySnapshot(lobbyId: string, state: SpinLobbyState, userId?: string) {
  const cfg = SPIN_LOBBY_CONFIG[lobbyId];
  const remaining = state.countdownStartedAt ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - state.countdownStartedAt)) / 1000)) : null;
  const profiles = state.players.length ? await db.userProfile.findMany({ where: { userId: { in: state.players } }, select: { userId: true, username: true, avatarUrl: true } }) : [];
  const usernameMap = new Map(profiles.map(p => [p.userId, p.username]));
  const avatarMap = new Map(profiles.map(p => [p.userId, p.avatarUrl]));
  const liveBets = await db.gameBet.findMany({ where: { roundId: state.roundId }, orderBy: { placedAt: "asc" } });
  const totalPool = liveBets.reduce((sum, b) => sum + Number(b.amount), 0);
  const myBet = userId ? liveBets.find(b => b.userId === userId) : undefined;
  const recent = await db.gameRound.findMany({ where: { gameType: "spin_battle", lobbyId, status: "completed", resultData: { not: null } }, orderBy: { roundNumber: "desc" }, take: 10, select: { roundNumber: true, resultData: true, settledAt: true } });
  const recentWinnerIds = recent.map(r => decodeResultData(r.resultData).winner).filter(Boolean);
  const recentProfiles = recentWinnerIds.length ? await db.userProfile.findMany({ where: { userId: { in: recentWinnerIds } }, select: { userId: true, username: true, avatarUrl: true } }) : [];
  const recentMap = new Map(recentProfiles.map(p => [p.userId, p]));
  const recentWinners = recent.map(r => { const d = decodeResultData(r.resultData); const p = d.winner ? recentMap.get(d.winner) : undefined; return { roundNumber: r.roundNumber, winnerId: d.winner ?? null, winnerUsername: p?.username ?? null, winnerPayout: d.winnerPayout ?? 0, timestamp: r.settledAt?.toISOString() ?? new Date().toISOString(), avatar: p?.avatarUrl ?? null }; });
  return {
    lobbyId, roundId: state.roundId, roundNumber: state.roundNumber, phase: state.phase,
    playerCount: state.players.length, maxPlayers: cfg.maxPlayers, minBet: cfg.minBet, maxBet: cfg.maxBet,
    totalPool, timeRemaining: remaining, winnerId: state.winnerId, winnerUsername: state.winnerId ? (usernameMap.get(state.winnerId) ?? null) : null,
    winnerPayout: state.winnerPayout, canJoin: ["waiting", "countdown"].includes(state.phase) && state.players.length < cfg.maxPlayers,
    players: liveBets.map((bet, i) => { const amount=Number(bet.amount); const start=totalPool>0 ? liveBets.slice(0,i).reduce((sum,b)=>sum+Number(b.amount),0)/totalPool*360 : 0; const end=totalPool>0 ? liveBets.slice(0,i+1).reduce((sum,b)=>sum+Number(b.amount),0)/totalPool*360 : 360/(liveBets.length||1)*(i+1); const colors=["#FF0000","#0066FF","#00CC44","#FFD700","#FF8C00","#9400D3","#FF1493","#00FFFF","#FF6347","#ADFF2F","#8B4513","#4169E1"]; return { userId: bet.userId, username: usernameMap.get(bet.userId) ?? `Player ${i + 1}`, index: i, avatar: avatarMap.get(bet.userId) ?? null, betAmount: amount, color: colors[i % colors.length], segmentStart: start, segmentEnd: end, probability: totalPool>0 ? amount/totalPool*100 : 0 }; }),
    myBet: userId ? { inRound: !!myBet, amount: myBet ? Number(myBet.amount) : null } : null,
    recentWinners, serverSeedHash: state.serverSeedHash, verificationId: (await db.gameRound.findUnique({ where: { id: state.roundId }, select: { verificationId: true } }))?.verificationId ?? null,
  };
}

export async function getSpinLobbyStates() {
  const result: Record<string, any> = {};
  for (const lobbyId of Object.keys(SPIN_LOBBY_CONFIG)) result[lobbyId] = await buildLobbySnapshot(lobbyId, await ensureRound(lobbyId));
  return result;
}

export async function getSpinLobbyState(lobbyId: string, userId: string) {
  const cfg = SPIN_LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 404, code: "NOT_FOUND" });
  return buildLobbySnapshot(lobbyId, await ensureRound(lobbyId), userId);
}

export async function joinSpinLobby(userId: string, lobbyId: string, betAmount: number) {
  const cfg = SPIN_LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });
  const [gameEnabled, maintenance, lobbyEnabled, minBet, maxBet] = await Promise.all([
    getConfigValue<boolean>("game.spin_battle.enabled", true),
    getConfigValue<boolean>("game.spin_battle.maintenance", false),
    getConfigValue<boolean>(`game.spin_battle.lobby.${lobbyId}.enabled`, true),
    getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.min_bet`, cfg.minBet),
    getConfigValue<number>(`game.spin_battle.lobby.${lobbyId}.max_bet`, cfg.maxBet),
  ]);
  if (!gameEnabled) throw Object.assign(new Error("Spin Battle is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (maintenance) throw Object.assign(new Error("Spin Battle is under maintenance"), { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (!lobbyEnabled) throw Object.assign(new Error(`Lobby ${lobbyId} is currently unavailable`), { statusCode: 503, code: "LOBBY_DISABLED" });
  await checkRoomAccess(userId, "spin_battle", lobbyId);
  if (betAmount < minBet || betAmount > maxBet) throw Object.assign(new Error(`Bet must be $${minBet}–$${maxBet} for Lobby ${lobbyId}`), { statusCode: 400, code: "INVALID_BET_AMOUNT" });

  const state = await ensureRound(lobbyId);
  if (!["waiting", "countdown"].includes(state.phase)) throw Object.assign(new Error(`Lobby ${lobbyId} is not accepting players — phase: ${state.phase}`), { statusCode: 409, code: "LOBBY_NOT_OPEN" });

  let roundId = state.roundId;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game_rounds WHERE id = ${roundId} FOR UPDATE`;
    const round = await tx.gameRound.findUnique({ where: { id: roundId }, select: { status: true } });
    if (!round || !["waiting", "countdown"].includes(round.status)) throw Object.assign(new Error("Betting is closed"), { statusCode: 409, code: "BETTING_CLOSED" });
    const count = await tx.gameBet.count({ where: { roundId } });
    if (count >= cfg.maxPlayers) throw Object.assign(new Error("Lobby is full"), { statusCode: 409, code: "LOBBY_FULL" });
    const existing = await tx.gameBet.findFirst({ where: { roundId, userId } });
    if (existing) throw Object.assign(new Error("You are already in this lobby"), { statusCode: 409, code: "ALREADY_JOINED" });
    await debitWallet(tx, userId, "game", betAmount);
    const bet = await tx.gameBet.create({ data: { roundId, userId, amount: betAmount, betData: JSON.stringify({ lobby: lobbyId, bet: betAmount }) } });
    await writeLedgerEntry(tx, { userId, type: "game_bet", fromWallet: "game", amount: betAmount, description: "Spin battle bet", referenceId: bet.id, referenceType: "game_bet", metadata: { lobbyId, roundId } });
  });

  const after = await ensureRound(lobbyId);
  if (after.players.length >= 2 && after.phase === "waiting") {
    const countdownStartedAt = Date.now();
    await db.gameRound.updateMany({ where: { id: roundId, status: "waiting" }, data: { status: "countdown", resultData: JSON.stringify({ countdownStartedAt }) } });
  }
  const final = await ensureRound(lobbyId);
  return { lobbyId, roundId, betAmount, minBet: cfg.minBet, maxBet: cfg.maxBet, playerCount: final.players.length, maxPlayers: cfg.maxPlayers, phase: final.phase, timeRemaining: final.countdownStartedAt ? Math.max(0, Math.ceil((COUNTDOWN_MS - (Date.now() - final.countdownStartedAt)) / 1000)) : null };
}
