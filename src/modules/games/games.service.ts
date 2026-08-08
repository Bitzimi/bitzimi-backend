import { db } from "../../db";

const GAME_TYPES = [
  "color_game","spin_battle","dice_duel","dice_royale",
  "dice_arena","reaction_tap","pvp_coinflip",
] as const;

export type GameType = typeof GAME_TYPES[number];

// ── Game stats (all-time) ─────────────────────────────────────────────────────

export async function getGameStats(userId: string) {
  const stats = await db.gameStat.findMany({ where: { userId } });
  const totals = stats.reduce(
    (acc, s) => ({
      totalGames:   acc.totalGames   + s.totalGames,
      wins:         acc.wins         + s.wins,
      losses:       acc.losses       + s.losses,
      totalWagered: acc.totalWagered + s.totalWagered,
      totalWon:     acc.totalWon     + s.totalWon,
    }),
    { totalGames: 0, wins: 0, losses: 0, totalWagered: 0, totalWon: 0 }
  );

  return {
    overall: {
      ...totals,
      profit:  totals.totalWon - totals.totalWagered,
      winRate: totals.totalGames > 0 ? (totals.wins / totals.totalGames) * 100 : 0,
    },
    byGame: Object.fromEntries(
      stats.map(s => [s.gameType, {
        totalGames:   s.totalGames,
        wins:         s.wins,
        losses:       s.losses,
        totalWagered: s.totalWagered,
        totalWon:     s.totalWon,
        profit:       s.totalWon - s.totalWagered,
        winRate:      s.totalGames > 0 ? (s.wins / s.totalGames) * 100 : 0,
      }])
    ),
  };
}

// ── Game history (recent bets) ────────────────────────────────────────────────

export async function getGameHistory(userId: string, opts: { cursor?: string; limit?: number; gameType?: string }) {
  const { cursor, limit = 20, gameType } = opts;
  const where: any = { userId };
  if (gameType) where.round = { gameType };
  if (cursor) {
    const anchor = await db.gameBet.findUnique({ where: { id: cursor } });
    if (anchor) where.placedAt = { lt: anchor.placedAt };
  }

  const rows = await db.gameBet.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: limit + 1,
    include: { round: { select: { gameType: true, lobbyId: true, roundNumber: true, status: true } } },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(b => ({
      id:          b.id,
      gameType:    b.round.gameType,
      lobbyId:     b.round.lobbyId,
      roundNumber: b.round.roundNumber,
      roundStatus: b.round.status,
      amount:      b.amount,
      betData:     JSON.parse(b.betData),
      outcome:     b.outcome,
      payout:      b.payout,
      platformFee: b.platformFee,
      settled:     b.settled,
      placedAt:    b.placedAt.toISOString(),
      settledAt:   b.settledAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}
