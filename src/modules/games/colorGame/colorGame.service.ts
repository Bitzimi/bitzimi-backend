/**
 * Color Prediction — server-authoritative round management.
 *
 * One global 90-second schedule is shared by every Color lobby.
 * Display round 1 starts at platform midnight and resets each day.
 * Lifecycle inside each 90s slot: WAITING 79s → SPINNING 6s → RESULT 5s.
 *
 * Financial rule:
 *   - Bet placement debits the game wallet but creates NO wallet transaction row.
 *   - Loss creates exactly one game_loss row for the stake (debit presentation).
 *   - Win creates exactly one game_win row for the total payout.
 *   - Void creates exactly one refund row for the full stake.
 */
import { db } from "../../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { recordGameResult } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";
import { getConfigValue, getGameFeeRate } from "../../admin/config/admin.config.service";
import { generateServerSeed, hashServerSeed, generateClientSeed, deriveColorResult, generateVerificationId } from "../provablyFair";
import { checkRoomAccess } from "../../admin/games/admin.games.service";
import { getLobbyPresenceCount } from "./colorGame.presence";

export const LOBBY_CONFIG: Record<string, { minBet: number; maxBet: number }> = {
  A: { minBet: 1, maxBet: 20 },
  B: { minBet: 21, maxBet: 100 },
  C: { minBet: 101, maxBet: 1000 },
  D: { minBet: 1001, maxBet: 5000 },
};

const activeColorTickers = new Set<string>();
const ROUND_DURATION_MS = 90_000;
const WAITING_DURATION_MS = 79_000;
const SPINNING_DURATION_MS = 6_000;
const RESULT_DURATION_MS = 5_000;
const ROUND_TIME_ZONE = "Africa/Lagos";

interface LobbyState {
  roundId: string;
  roundNumber: number;
  dailyRoundNumber: number;
  phase: "waiting" | "spinning" | "result";
  phaseStartedAt: number;
  result: "red" | "blue" | null;
  redTotal: number;
  blueTotal: number;
  voided: boolean;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string | null;
}

const lobbyStates = new Map<string, LobbyState>();

function getGlobalRound(nowMs = Date.now()): { dailyRoundNumber: number; startMs: number } {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: ROUND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(nowMs)).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const hour = Number(parts.hour), minute = Number(parts.minute), second = Number(parts.second);
  const localSeconds = hour * 3600 + minute * 60 + second + new Date(nowMs).getMilliseconds() / 1000;
  const slot = Math.floor(localSeconds * 1000 / ROUND_DURATION_MS) + 1;
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  const observedOffset = Date.UTC(year, month - 1, day, hour, minute, second) - nowMs + new Date(nowMs).getMilliseconds();
  const midnightMs = localMidnightAsUtc - observedOffset;
  return { dailyRoundNumber: slot, startMs: midnightMs + (slot - 1) * ROUND_DURATION_MS };
}

function parseTeam(betData: string): "red" | "blue" { return JSON.parse(betData).team as "red" | "blue"; }

async function createScheduledRound(lobbyId: string, dailyRoundNumber: number, startMs: number): Promise<LobbyState> {
  const last = await db.gameRound.findFirst({ where: { gameType: "color_game", lobbyId }, orderBy: { roundNumber: "desc" }, select: { roundNumber: true } });
  const roundNumber = (last?.roundNumber ?? 0) + 1;
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const round = await db.gameRound.create({ data: { gameType: "color_game", lobbyId, roundNumber, status: "waiting", startedAt: new Date(startMs), serverSeed, serverSeedHash, dailyRoundNumber, verificationId: generateVerificationId("color_game") } });
  const state: LobbyState = { roundId: round.id, roundNumber, dailyRoundNumber, phase: "waiting", phaseStartedAt: startMs, result: null, redTotal: 0, blueTotal: 0, voided: false, serverSeed, serverSeedHash, clientSeed: null };
  lobbyStates.set(lobbyId, state);
  return state;
}

async function ensureLobby(lobbyId: string): Promise<LobbyState> {
  const cached = lobbyStates.get(lobbyId);
  const schedule = getGlobalRound();
  if (cached && cached.dailyRoundNumber === schedule.dailyRoundNumber) return cached;
  const active = await db.gameRound.findFirst({ where: { gameType: "color_game", lobbyId, status: { in: ["waiting", "spinning", "result"] } }, orderBy: { startedAt: "desc" } });
  if (active && active.dailyRoundNumber === schedule.dailyRoundNumber) {
    const bets = await db.gameBet.findMany({ where: { roundId: active.id } });
    const savedSeed = active.serverSeed ?? generateServerSeed();
    const resultData = active.resultData ? JSON.parse(active.resultData) : null;
    const state: LobbyState = { roundId: active.id, roundNumber: active.roundNumber, dailyRoundNumber: schedule.dailyRoundNumber, phase: active.status as LobbyState["phase"], phaseStartedAt: schedule.startMs, result: resultData?.result ?? null, redTotal: bets.filter(b => parseTeam(b.betData) === "red").reduce((s, b) => s + b.amount, 0), blueTotal: bets.filter(b => parseTeam(b.betData) === "blue").reduce((s, b) => s + b.amount, 0), voided: active.status === "result" && resultData?.voided === true, serverSeed: savedSeed, serverSeedHash: active.serverSeedHash ?? hashServerSeed(savedSeed), clientSeed: active.clientSeed ?? null };
    lobbyStates.set(lobbyId, state);
    return state;
  }
  return createScheduledRound(lobbyId, schedule.dailyRoundNumber, schedule.startMs);
}

async function settleRound(lobbyId: string, state: LobbyState): Promise<void> {
  const bets = await db.gameBet.findMany({ where: { roundId: state.roundId, settled: false } });
  if (bets.length === 0) return;
  const hasRedBets = state.redTotal > 0, hasBlueBets = state.blueTotal > 0;
  if (!hasRedBets || !hasBlueBets) {
    state.voided = true;
    await db.$transaction(async tx => {
      for (const bet of bets) {
        await creditWallet(tx, bet.userId, "game", bet.amount);
        await writeLedgerEntry(tx, { userId: bet.userId, type: "transfer", toWallet: "game", amount: bet.amount, description: "Color game void — full refund", referenceId: bet.id, referenceType: "game_bet", metadata: { gameType: "color_game", roundId: state.roundId, roundNumber: state.dailyRoundNumber, voided: true } });
        await tx.gameBet.update({ where: { id: bet.id }, data: { outcome: "draw", payout: bet.amount, platformFee: 0, settled: true, settledAt: new Date() } });
        await tx.notification.create({ data: { userId: bet.userId, type: "game_void", title: "⚠️ Color Prediction Round Voided", message: `Round ${state.dailyRoundNumber} was voided because only one side had bets. Your ${bet.amount.toFixed(2)} stake was fully refunded.`, metadata: JSON.stringify({ game: "color_game", roundId: state.roundId, roundNumber: state.dailyRoundNumber, payout: bet.amount, voided: true }) } });
      }
    });
    await db.gameRound.update({ where: { id: state.roundId }, data: { status: "cancelled_insufficient_opposition", settledAt: new Date(), resultData: JSON.stringify({ result: state.result, voided: true }) } });
    return;
  }
  const winningTeam = state.result;
  if (!winningTeam) return;
  const winningTotal = winningTeam === "red" ? state.redTotal : state.blueTotal;
  const losingTotal = winningTeam === "red" ? state.blueTotal : state.redTotal;
  const feeRate = await getGameFeeRate("color_game"), fee = losingTotal * feeRate;
  await db.$transaction(async tx => {
    for (const bet of bets) {
      const betTeam = parseTeam(bet.betData), isWinner = betTeam === winningTeam;
      const payout = isWinner ? parseFloat((bet.amount + (losingTotal - fee) * (bet.amount / winningTotal)).toFixed(8)) : 0;
      if (isWinner) {
        await creditWallet(tx, bet.userId, "game", payout);
        await writeLedgerEntry(tx, { userId: bet.userId, type: "game_win", toWallet: "game", amount: payout, description: `Color game win — team ${winningTeam}`, referenceId: bet.id, referenceType: "game_bet", metadata: { team: winningTeam, roundId: state.roundId, roundNumber: state.dailyRoundNumber, stake: bet.amount, payout } });
        await tx.notification.create({ data: { userId: bet.userId, type: "game_win", title: "🎉 Color Prediction Victory!", message: `You won ${payout.toFixed(2)} on ${winningTeam.toUpperCase()} in round ${state.dailyRoundNumber}.`, metadata: JSON.stringify({ game: "color_game", roundId: state.roundId, roundNumber: state.dailyRoundNumber, team: betTeam, winner: winningTeam, stake: bet.amount, payout }) } });
      } else {
        await writeLedgerEntry(tx, { userId: bet.userId, type: "game_loss", fromWallet: "game", amount: bet.amount, description: `Color game loss — team ${betTeam}`, referenceId: bet.id, referenceType: "game_bet", metadata: { team: betTeam, winner: winningTeam, roundId: state.roundId, roundNumber: state.dailyRoundNumber, stake: bet.amount, payout: 0 } });
        await tx.notification.create({ data: { userId: bet.userId, type: "game_loss", title: "Color Prediction Result", message: `You lost ${bet.amount.toFixed(2)} on ${betTeam.toUpperCase()} in round ${state.dailyRoundNumber}.`, metadata: JSON.stringify({ game: "color_game", roundId: state.roundId, roundNumber: state.dailyRoundNumber, team: betTeam, winner: winningTeam, stake: bet.amount, payout: 0 }) } });
      }
      const userFee = bet.amount * feeRate;
      await tx.gameBet.update({ where: { id: bet.id }, data: { outcome: isWinner ? "win" : "loss", payout, platformFee: userFee, settled: true, settledAt: new Date() } });
      await recordGameResult({ tx, userId: bet.userId, gameType: "color_game", wagered: bet.amount, won: isWinner, payout });
      await createGameFeeJobInTx(tx, { userId: bet.userId, userFee, isMultiGame: true, eventRefId: state.roundId });
    }
  });
}

async function enterSpinning(lobbyId: string, state: LobbyState): Promise<void> {
  if (state.phase !== "waiting") return;
  state.phase = "spinning"; state.phaseStartedAt = Date.now();
  const bettors = await db.gameBet.findMany({ where: { roundId: state.roundId }, select: { userId: true } });
  const sortedIds = [...new Set(bettors.map(b => String(b.userId)))].sort();
  const clientSeed: string = String(generateClientSeed(...sortedIds, String(state.roundId)));
  const result = deriveColorResult(String(state.serverSeed), clientSeed, Number(state.dailyRoundNumber));
  state.clientSeed = clientSeed; state.result = result; state.serverSeedHash = hashServerSeed(String(state.serverSeed));
  await db.gameRound.update({ where: { id: state.roundId }, data: { status: "spinning", clientSeed, serverSeed: state.serverSeed, serverSeedHash: state.serverSeedHash, nonce: state.dailyRoundNumber, resultData: JSON.stringify({ result }) } });
}

async function tickLobby(lobbyId: string): Promise<void> {
  const state = await ensureLobby(lobbyId);
  const schedule = getGlobalRound();
  if (state.dailyRoundNumber !== schedule.dailyRoundNumber) {
    if (state.phase === "result") await db.gameRound.update({ where: { id: state.roundId }, data: { status: state.voided ? "cancelled_insufficient_opposition" : "completed", settledAt: new Date(), serverSeed: state.serverSeed } }).catch(() => {});
    lobbyStates.delete(lobbyId);
    await createScheduledRound(lobbyId, schedule.dailyRoundNumber, schedule.startMs);
    return;
  }
  const elapsed = Date.now() - schedule.startMs;
  if (state.phase === "waiting" && elapsed >= WAITING_DURATION_MS) await enterSpinning(lobbyId, state);
  else if (state.phase === "spinning" && elapsed >= WAITING_DURATION_MS + SPINNING_DURATION_MS) { state.phase = "result"; state.phaseStartedAt = Date.now(); await db.gameRound.update({ where: { id: state.roundId }, data: { status: "result" } }); await settleRound(lobbyId, state); }
  else if (state.phase === "result" && elapsed >= ROUND_DURATION_MS) { await db.gameRound.update({ where: { id: state.roundId }, data: { status: state.voided ? "cancelled_insufficient_opposition" : "completed", settledAt: new Date(), serverSeed: state.serverSeed } }).catch(() => {}); lobbyStates.delete(lobbyId); const next = getGlobalRound(); await createScheduledRound(lobbyId, next.dailyRoundNumber, next.startMs); }
}

async function recoverStaleColorRounds(): Promise<void> {
  const current=getGlobalRound().dailyRoundNumber;
  const stale=await db.gameRound.findMany({where:{gameType:"color_game",status:{in:["waiting","spinning","result"]},dailyRoundNumber:{lt:current}},orderBy:{startedAt:"asc"},take:100});
  for(const round of stale){
    const bets=await db.gameBet.findMany({where:{roundId:round.id,settled:false}});
    if(!bets.length){await db.gameRound.update({where:{id:round.id},data:{status:"completed",settledAt:new Date()}}).catch(()=>{});continue;}
    const savedSeed:string=String(round.serverSeed??generateServerSeed());
    const ids=[...new Set(bets.map(b=>String(b.userId)))].sort();
    const clientSeed:string=String(round.clientSeed??generateClientSeed(...ids,String(round.id)));
    const rd=round.resultData?JSON.parse(round.resultData):null;
    const result=rd?.result==="red"||rd?.result==="blue"?rd.result:deriveColorResult(savedSeed,clientSeed,Number(round.dailyRoundNumber??round.roundNumber));
    const redTotal=bets.filter(b=>parseTeam(String(b.betData))==="red").reduce((n,b)=>n+b.amount,0);
    const blueTotal=bets.filter(b=>parseTeam(String(b.betData))==="blue").reduce((n,b)=>n+b.amount,0);
    const state:LobbyState={roundId:String(round.id),roundNumber:Number(round.roundNumber),dailyRoundNumber:Number(round.dailyRoundNumber??round.roundNumber),phase:"result",phaseStartedAt:Date.now(),result,redTotal,blueTotal,voided:false,serverSeed:savedSeed,serverSeedHash:String(round.serverSeedHash??hashServerSeed(savedSeed)),clientSeed};
    await settleRound(String(round.lobbyId),state);
    await db.gameRound.update({where:{id:round.id},data:{status:state.voided?"cancelled_insufficient_opposition":"completed",settledAt:new Date(),serverSeed:savedSeed,serverSeedHash:state.serverSeedHash,clientSeed,nonce:state.dailyRoundNumber,resultData:JSON.stringify({result,voided:state.voided})}}).catch(()=>{});
  }
}

export async function registerColorLobby(lobbyId: string, minBet: number, maxBet: number): Promise<void> {
  LOBBY_CONFIG[lobbyId] = { minBet, maxBet };
  if (activeColorTickers.has(lobbyId)) return;
  activeColorTickers.add(lobbyId);
  if (activeColorTickers.size === 1) setInterval(() => recoverStaleColorRounds().catch(err => console.error("[ColorGame:recovery]", err)), 3000);
  setInterval(() => tickLobby(lobbyId).catch(err => console.error(`[ColorGame:${lobbyId}]`, err)), 1000);
  console.log(`[ColorGame] Lobby ${lobbyId} registered (global 90s schedule, min=$${minBet} max=$${maxBet})`);
}

export async function startColorGameLobbies(): Promise<void> {
  const configuredIds = await getConfigValue<string[]>("game.color_game.lobby_ids", Object.keys(LOBBY_CONFIG));
  for (const lobbyId of configuredIds) { const minBet = await getConfigValue<number>(`game.color_game.lobby.${lobbyId}.min_bet`, LOBBY_CONFIG[lobbyId]?.minBet ?? 1); const maxBet = await getConfigValue<number>(`game.color_game.lobby.${lobbyId}.max_bet`, LOBBY_CONFIG[lobbyId]?.maxBet ?? 100); await registerColorLobby(lobbyId, minBet, maxBet); }
  console.log(`[ColorGame] Lobbies started: ${configuredIds.join(", ")} — 960 scheduled rounds/day`);
}

export async function getAllLobbyStates() { const states: Record<string, any> = {}; for (const lobbyId of Object.keys(LOBBY_CONFIG)) states[lobbyId] = await getLobbyState(lobbyId); return states; }

export async function getLobbyState(lobbyId: string, userId?: string) {
  await recoverStaleColorRounds();
  const state = await ensureLobby(lobbyId);
  const schedule = getGlobalRound();
  const elapsed = Math.max(0, Date.now() - schedule.startMs);
  const cfg = LOBBY_CONFIG[lobbyId];
  if (state.dailyRoundNumber === schedule.dailyRoundNumber) { if (elapsed < WAITING_DURATION_MS) state.phase = "waiting"; else if (elapsed < WAITING_DURATION_MS + SPINNING_DURATION_MS) state.phase = "spinning"; else state.phase = "result"; }
  const currentBets = await db.gameBet.findMany({ where: { roundId: state.roundId }, include: { user: { include: { profile: { select: { username: true } } } } }, orderBy: { placedAt: "desc" }, take: 40 });
  const redBets = currentBets.filter(b => parseTeam(b.betData) === "red"), blueBets = currentBets.filter(b => parseTeam(b.betData) === "blue");
  let myBet: { team: string; amount: number; outcome: string | null; payout: number | null } | null = null;
  if (userId) { const bet = currentBets.find(b => b.userId === userId); if (bet) myBet = { team: parseTeam(bet.betData), amount: bet.amount, outcome: bet.outcome, payout: bet.payout ?? null }; }
  const historyRows = await db.gameRound.findMany({ where: { gameType: "color_game", lobbyId: "A", status: { in: ["completed", "cancelled_insufficient_opposition"] } }, orderBy: { startedAt: "desc" }, take: 50, select: { roundNumber: true, dailyRoundNumber: true, resultData: true, settledAt: true, startedAt: true, status: true } });
  const history = historyRows.map(r => { const data = r.resultData ? JSON.parse(r.resultData) : null; return { roundNumber: r.dailyRoundNumber ?? r.roundNumber, result: data?.result ?? null, voided: r.status === "cancelled_insufficient_opposition" || data?.voided === true, timestamp: r.settledAt?.toISOString() ?? r.startedAt.toISOString() }; }).filter(r => r.result !== null);
  const historyRoundRows = userId ? await db.gameRound.findMany({ where: { gameType: "color_game", lobbyId }, orderBy: { startedAt: "desc" }, take: 50, select: { id: true, roundNumber: true, dailyRoundNumber: true } }) : [];
  const historyRoundNumbers = new Map(historyRoundRows.map(r => [r.id, r.dailyRoundNumber ?? r.roundNumber]));
  const personalBets = userId && historyRoundRows.length ? await db.gameBet.findMany({ where: { userId, roundId: { in: historyRoundRows.map(r => r.id) } }, orderBy: { placedAt: "desc" }, take: 50 }) : [];
  const myBetHistory = personalBets.map(b => ({ id: b.id, roundNumber: historyRoundNumbers.get(b.roundId) ?? 0, team: parseTeam(b.betData), amount: b.amount, timestamp: b.placedAt.toISOString(), result: b.outcome === "win" ? "win" : b.outcome === "loss" ? "loss" : b.outcome === "draw" ? "draw" : undefined, payout: b.payout ?? undefined, lobbyId }));
  const timeRemaining = state.phase === "waiting" ? Math.max(0, Math.ceil((WAITING_DURATION_MS - elapsed) / 1000)) : state.phase === "spinning" ? Math.max(0, Math.ceil((WAITING_DURATION_MS + SPINNING_DURATION_MS - elapsed) / 1000)) : Math.max(0, Math.ceil((ROUND_DURATION_MS - elapsed) / 1000));
  return { lobbyId, roundId: state.roundId, roundNumber: state.roundNumber, dailyRoundNumber: schedule.dailyRoundNumber, serverSeedHash: state.serverSeedHash, phase: state.phase, timeRemaining, result: state.result, voided: state.voided, redTotal: state.redTotal, blueTotal: state.blueTotal, redPlayers: redBets.length, bluePlayers: blueBets.length, lobbyPlayers: await getLobbyPresenceCount(lobbyId), minBet: cfg.minBet, maxBet: cfg.maxBet, currentBets: currentBets.slice(0, 20).map(b => ({ id: b.id, username: b.user.profile?.username ?? "Player", amount: b.amount, team: parseTeam(b.betData) })), history, myBet, myBetHistory };
}

export async function placeBet(userId: string, lobbyId: string, team: "red" | "blue", amount: number) {
  const cfg = LOBBY_CONFIG[lobbyId];
  if (!cfg) throw Object.assign(new Error(`Unknown lobby: ${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });
  const [gameEnabled, gameMaintenance, lobbyEnabled, cfgMinBet, cfgMaxBet] = await Promise.all([getConfigValue<boolean>("game.color_game.enabled", true), getConfigValue<boolean>("game.color_game.maintenance", false), getConfigValue<boolean>(`game.color_game.lobby.${lobbyId}.enabled`, true), getConfigValue<number>(`game.color_game.lobby.${lobbyId}.min_bet`, cfg.minBet), getConfigValue<number>(`game.color_game.lobby.${lobbyId}.max_bet`, cfg.maxBet)]);
  if (!gameEnabled) throw Object.assign(new Error("Color Prediction is currently unavailable"), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error("Color Prediction is under maintenance"), { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (!lobbyEnabled) throw Object.assign(new Error(`Lobby ${lobbyId} is currently unavailable`), { statusCode: 503, code: "LOBBY_DISABLED" });
  await checkRoomAccess(userId, "color_game", lobbyId);
  if (amount < cfgMinBet || amount > cfgMaxBet) throw Object.assign(new Error(`Bet must be $${cfgMinBet}–$${cfgMaxBet} for lobby ${lobbyId}`), { statusCode: 400, code: "INVALID_BET_AMOUNT" });
  const state = await ensureLobby(lobbyId), schedule = getGlobalRound();
  if (state.dailyRoundNumber !== schedule.dailyRoundNumber) throw Object.assign(new Error("Round is changing. Please try again."), { statusCode: 409, code: "ROUND_CHANGING" });
  const elapsed = Date.now() - schedule.startMs;
  if (elapsed >= WAITING_DURATION_MS) throw Object.assign(new Error(`Lobby ${lobbyId} not accepting bets — betting is closed`), { statusCode: 409, code: "BETTING_CLOSED" });
  await db.$transaction(async tx => { const existingBet = await tx.gameBet.findFirst({ where: { roundId: state.roundId, userId } }); if (existingBet) throw Object.assign(new Error("You already placed a bet this round"), { statusCode: 409, code: "BET_ALREADY_PLACED" }); await debitWallet(tx, userId, "game", amount); await tx.gameBet.create({ data: { roundId: state.roundId, userId, amount, betData: JSON.stringify({ team }) } }); });
  if (team === "red") state.redTotal += amount; else state.blueTotal += amount;
  return { roundId: state.roundId, roundNumber: state.roundNumber, dailyRoundNumber: state.dailyRoundNumber, team, amount };
}
