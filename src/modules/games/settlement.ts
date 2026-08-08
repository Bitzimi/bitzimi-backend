/**
 * Game Settlement Engine — atomic win/loss wallet operations.
 *
 * Responsibilities:
 *   1. Wallet crediting (game wallet → winner)
 *   2. Game stat recording (wins, losses, wagered, won)
 *   3. Referral activation (first game bet activates referral)
 *
 * Commission is NOT fired here (Section D fix). Each game service calls
 * triggerGameFeeCommission() independently for ALL players (win AND loss),
 * which is the correct post-Phase-3F-correction behaviour.
 * Firing commissions here would cause double-commission for winners in games
 * that also call triggerGameFeeCommission() (e.g. SpinBattle).
 */
import { db } from "../../db";
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { activateReferral } from "../referrals/referrals.service";

export const PLATFORM_FEE_RATE = 0.10;

// ── Upsert game stats ──────────────────────────────────────────────────────────

export async function recordGameResult(opts: {
  tx:          any;
  userId:      string;
  gameType:    string;
  wagered:     number;
  won:         boolean;
  payout:      number;    // 0 on loss
}): Promise<void> {
  const { tx, userId, gameType, wagered, won, payout } = opts;
  await tx.gameStat.upsert({
    where:  { userId_gameType: { userId, gameType } },
    create: {
      userId, gameType,
      totalGames: 1, wins: won ? 1 : 0, losses: won ? 0 : 1,
      totalWagered: wagered, totalWon: payout,
    },
    update: {
      totalGames:   { increment: 1 },
      wins:         won ? { increment: 1 } : undefined,
      losses:       won ? undefined : { increment: 1 },
      totalWagered: { increment: wagered },
      totalWon:     { increment: payout },
    },
  });
}

// ── Settle a single-winner game result ────────────────────────────────────────

export interface SingleWinnerResult {
  winnerId:    string;
  loserIds:    string[];
  totalPool:   number;
  platformFee: number;
  winnerPayout:number;
  gameType:    string;
  roundId?:    string;
}

export async function settleSingleWinner(result: SingleWinnerResult): Promise<void> {
  // platformFee is informational — the fee is implicit: winnerPayout = totalPool - platformFee
  // Each game service calls triggerGameFeeCommission() separately using platformFee
  await db.$transaction(async (tx) => {
    await settleSingleWinnerInTx(tx, result);
  });

  // Commission NOT fired here — each game service calls createGameFeeJobInTx()
  // for all players (win OR loss) inside its own atomic transaction.
}

/**
 * Same logic as settleSingleWinner but operates on an already-open transaction client.
 * Use this when the caller needs wallet credit, ledger, and game stats to be part of
 * a larger atomic operation (e.g. SpinBattle: payout + round update + commission jobs).
 * Never opens a nested transaction — safe for Prisma's interactive transactions.
 */
export async function settleSingleWinnerInTx(tx: any, result: SingleWinnerResult): Promise<void> {
  const { winnerId, loserIds, totalPool, winnerPayout, gameType } = result;

  await creditWallet(tx, winnerId, "game", winnerPayout);
  await writeLedgerEntry(tx, {
    userId: winnerId, type: "game_win", toWallet: "game", amount: winnerPayout,
    description: `${gameType} win`, referenceType: "game_round",
    metadata: { gameType, totalPool },
  });

  const perPlayerStake = totalPool / (loserIds.length + 1);
  await recordGameResult({ tx, userId: winnerId, gameType, wagered: perPlayerStake, won: true, payout: winnerPayout });

  for (const loserId of loserIds) {
    await recordGameResult({ tx, userId: loserId, gameType, wagered: perPlayerStake, won: false, payout: 0 });
  }
}

// ── Settle a multi-winner game result (DiceArena: 1st + 2nd) ─────────────────

export interface MultiWinnerResult {
  winners:  Array<{ userId: string; payout: number; placement: 1 | 2 }>;
  losers:   Array<{ userId: string }>;
  totalPool:number;
  platformFee: number;
  perPlayerStake: number;
  gameType: string;
  roundId?: string;
}

export async function settleMultiWinner(result: MultiWinnerResult): Promise<void> {
  const { winners, losers, perPlayerStake, gameType } = result;

  await db.$transaction(async (tx) => {
    for (const w of winners) {
      await creditWallet(tx, w.userId, "game", w.payout);
      await writeLedgerEntry(tx, {
        userId: w.userId, type: "game_win", toWallet: "game", amount: w.payout,
        description: `${gameType} win — placement ${w.placement}`,
        referenceType: "game_round", metadata: { gameType, placement: w.placement },
      });
      await recordGameResult({ tx, userId: w.userId, gameType, wagered: perPlayerStake, won: true, payout: w.payout });
    }
    for (const l of losers) {
      await recordGameResult({ tx, userId: l.userId, gameType, wagered: perPlayerStake, won: false, payout: 0 });
    }
  });

  // Commission NOT fired here — each game service calls triggerGameFeeCommission()
  // for all players (win OR loss) after this function returns.
}

// ── Activate referral on first game bet ───────────────────────────────────────

export async function onGameBetPlaced(userId: string): Promise<void> {
  // Fire-and-forget — activates referral if not already active
  setImmediate(() =>
    activateReferral(userId).catch(err => console.error("[Settlement] Referral activation error:", err))
  );
}
