import { db } from "../../../db";
import { creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { recordGameResult } from "../settlement";
import { createGameFeeJobInTx } from "../../affiliates/commissions";
import { getGameFeeRate } from "../../admin/config/admin.config.service";
import { generateClientSeed, deriveColorResult } from "../provablyFair";

function parseTeam(value: string): "red" | "blue" {
  return JSON.parse(value).team as "red" | "blue";
}

async function getCanonicalRound(dailyRoundNumber: number) {
  return db.gameRound.findFirst({
    where: { gameType: "color_game", lobbyId: "A", dailyRoundNumber },
    orderBy: { startedAt: "asc" },
  });
}

export async function getGlobalColorResult(dailyRoundNumber: number) {
  const canonical = await getCanonicalRound(dailyRoundNumber);
  if (!canonical?.serverSeed) return null;

  const existing = canonical.resultData ? JSON.parse(canonical.resultData) : null;
  if (existing?.result === "red" || existing?.result === "blue") {
    return {
      result: existing.result as "red" | "blue",
      clientSeed: canonical.clientSeed ?? generateClientSeed("color-global", String(dailyRoundNumber)),
      serverSeed: canonical.serverSeed,
    };
  }

  const clientSeed = generateClientSeed("color-global", String(dailyRoundNumber));
  const result = deriveColorResult(canonical.serverSeed, clientSeed, dailyRoundNumber);
  return { result, clientSeed, serverSeed: canonical.serverSeed };
}

async function settleRecoveredRound(round: any, bets: any[], global: { result: "red" | "blue"; clientSeed: string; serverSeed: string }) {
  const redTotal = bets.filter(b => parseTeam(b.betData) === "red").reduce((s, b) => s + b.amount, 0);
  const blueTotal = bets.filter(b => parseTeam(b.betData) === "blue").reduce((s, b) => s + b.amount, 0);
  const isVoid = redTotal === 0 || blueTotal === 0;

  if (isVoid) {
    await db.$transaction(async tx => {
      for (const bet of bets) {
        await creditWallet(tx, bet.userId, "game", bet.amount);
        await writeLedgerEntry(tx, {
          userId: bet.userId,
          type: "transfer",
          toWallet: "game",
          amount: bet.amount,
          description: "Color game void — full refund",
          referenceId: bet.id,
          referenceType: "game_bet",
          metadata: { gameType: "color_game", roundId: round.id, roundNumber: round.dailyRoundNumber, voided: true },
        });
        await tx.gameBet.update({ where: { id: bet.id }, data: { outcome: "draw", payout: bet.amount, platformFee: 0, settled: true, settledAt: new Date() } });
        await tx.notification.create({
          data: {
            userId: bet.userId,
            type: "game_void",
            title: "⚠️ Color Prediction Round Voided",
            message: `Round ${round.dailyRoundNumber} was voided because only one side had bets. Your ${bet.amount.toFixed(2)} stake was fully refunded.`,
            metadata: JSON.stringify({ game: "color_game", roundId: round.id, roundNumber: round.dailyRoundNumber, payout: bet.amount, voided: true }),
          },
        });
      }
    });
    await db.gameRound.update({ where: { id: round.id }, data: { status: "cancelled_insufficient_opposition", settledAt: new Date(), resultData: JSON.stringify({ result: global.result, voided: true }) } });
    return;
  }

  const winningTotal = global.result === "red" ? redTotal : blueTotal;
  const losingTotal = global.result === "red" ? blueTotal : redTotal;
  const feeRate = await getGameFeeRate("color_game");
  const fee = losingTotal * feeRate;

  await db.$transaction(async tx => {
    for (const bet of bets) {
      const team = parseTeam(bet.betData);
      const won = team === global.result;
      const payout = won ? parseFloat((bet.amount + (losingTotal - fee) * (bet.amount / winningTotal)).toFixed(8)) : 0;
      if (won) {
        await creditWallet(tx, bet.userId, "game", payout);
        await writeLedgerEntry(tx, { userId: bet.userId, type: "game_win", toWallet: "game", amount: payout, description: `Color game win — team ${global.result}`, referenceId: bet.id, referenceType: "game_bet", metadata: { team, winner: global.result, roundId: round.id, roundNumber: round.dailyRoundNumber, stake: bet.amount, payout } });
        await tx.notification.create({ data: { userId: bet.userId, type: "game_win", title: "🎉 Color Prediction Victory!", message: `You won ${payout.toFixed(2)} on ${global.result.toUpperCase()} in round ${round.dailyRoundNumber}.`, metadata: JSON.stringify({ game: "color_game", roundId: round.id, roundNumber: round.dailyRoundNumber, team, winner: global.result, stake: bet.amount, payout }) } });
      } else {
        await writeLedgerEntry(tx, { userId: bet.userId, type: "game_loss", fromWallet: "game", amount: bet.amount, description: `Color game loss — team ${team}`, referenceId: bet.id, referenceType: "game_bet", metadata: { team, winner: global.result, roundId: round.id, roundNumber: round.dailyRoundNumber, stake: bet.amount, payout: 0 } });
        await tx.notification.create({ data: { userId: bet.userId, type: "game_loss", title: "Color Prediction Result", message: `You lost ${bet.amount.toFixed(2)} on ${team.toUpperCase()} in round ${round.dailyRoundNumber}.`, metadata: JSON.stringify({ game: "color_game", roundId: round.id, roundNumber: round.dailyRoundNumber, team, winner: global.result, stake: bet.amount, payout: 0 }) } });
      }
      const userFee = bet.amount * feeRate;
      await tx.gameBet.update({ where: { id: bet.id }, data: { outcome: won ? "win" : "loss", payout, platformFee: userFee, settled: true, settledAt: new Date() } });
      await recordGameResult({ tx, userId: bet.userId, gameType: "color_game", wagered: bet.amount, won, payout });
      await createGameFeeJobInTx(tx, { userId: bet.userId, userFee, isMultiGame: true, eventRefId: round.id });
    }
  });

  await db.gameRound.update({ where: { id: round.id }, data: { status: "completed", settledAt: new Date(), resultData: JSON.stringify({ result: global.result }) } });
}

let recoveryRunning = false;
let lastRecoveryAt = 0;

export async function recoverStaleColorRounds() {
  const now = Date.now();
  if (recoveryRunning || now - lastRecoveryAt < 3000) return;
  recoveryRunning = true;
  lastRecoveryAt = now;
  try {
    const stale = await db.gameRound.findMany({
      where: { gameType: "color_game", status: { in: ["waiting", "spinning", "result"] }, dailyRoundNumber: { lt: await currentDailyRoundNumber() } },
      orderBy: { startedAt: "asc" },
      take: 50,
    });
    for (const round of stale) {
      const bets = await db.gameBet.findMany({ where: { roundId: round.id, settled: false } });
      if (!bets.length) {
        await db.gameRound.update({ where: { id: round.id }, data: { status: round.status === "result" ? "completed" : "completed", settledAt: new Date() } }).catch(() => {});
        continue;
      }
      const global = await getGlobalColorResult(round.dailyRoundNumber);
      if (!global) continue;
      await settleRecoveredRound(round, bets, global);
    }
  } finally {
    recoveryRunning = false;
  }
}

async function currentDailyRoundNumber() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second) + now.getMilliseconds() / 1000;
  return Math.floor(seconds * 1000 / 90000) + 1;
}
