/**
 * Football Service — Phase 16
 *
 * Handles all football data access: leagues, matches, predictions.
 * No AI engine — all predictions are admin-managed.
 */

import { db as prisma } from "../../db";

// ── Leagues ───────────────────────────────────────────────────────────────────

export async function getActiveLeagues() {
  return prisma.footballLeague.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

// ── Matches ───────────────────────────────────────────────────────────────────

export async function getTodaysMatches() {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return prisma.footballMatch.findMany({
    where: {
      kickoffAt: { gte: startOfDay, lte: endOfDay },
      status: { in: ["upcoming", "live"] },
    },
    include: { league: true },
    orderBy: { kickoffAt: "asc" },
  });
}

export async function getUpcomingMatches(leagueId?: string) {
  return prisma.footballMatch.findMany({
    where: {
      status: "upcoming",
      kickoffAt: { gte: new Date() },
      ...(leagueId ? { leagueId } : {}),
    },
    include: { league: true },
    orderBy: { kickoffAt: "asc" },
    take: 50,
  });
}

// ── Predictions (user-facing) ─────────────────────────────────────────────────

interface PredictionListQuery {
  isVip?: boolean;
  leagueId?: string;
  cursor?: string;
  limit?: number;
}

export async function getPublishedPredictions(q: PredictionListQuery) {
  const limit = q.limit ?? 20;
  const items = await prisma.footballPrediction.findMany({
    where: {
      status: "published",
      ...(q.isVip !== undefined ? { isVip: q.isVip } : {}),
      ...(q.leagueId ? { match: { leagueId: q.leagueId } } : {}),
    },
    include: {
      match: { include: { league: true } },
      result: true,
    },
    orderBy: { publishedAt: "desc" },
    take: limit + 1,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}

export async function getTodaysPredictions(isVipUser: boolean) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const where = {
    status: "published",
    publishedAt: { gte: startOfDay, lte: endOfDay },
  };

  const all = await prisma.footballPrediction.findMany({
    where,
    include: { match: { include: { league: true } }, result: true },
    orderBy: [{ isVip: "asc" }, { publishedAt: "desc" }],
  });

  // Free users: show 2 free predictions, lock VIP ones
  if (!isVipUser) {
    const free = all.filter(p => !p.isVip).slice(0, 2);
    const lockedCount = all.filter(p => p.isVip).length + Math.max(0, all.filter(p => !p.isVip).length - 2);
    return { predictions: free, lockedCount, isVip: false };
  }

  return { predictions: all, lockedCount: 0, isVip: true };
}

export async function getElitePicks(isVipUser: boolean) {
  if (!isVipUser) {
    return { locked: true, message: "Elite Picks are exclusive to VIP members." };
  }

  const picks = await prisma.footballPrediction.findMany({
    where: {
      status: "published",
      isVip: true,
      confidence: { gte: 75 },
    },
    include: { match: { include: { league: true } }, result: true },
    orderBy: [{ confidence: "desc" }, { publishedAt: "desc" }],
    take: 20,
  });

  return { locked: false, picks };
}

interface HistoryQuery {
  cursor?: string;
  limit?: number;
  outcome?: string;
}

export async function getPredictionHistory(q: HistoryQuery) {
  const limit = q.limit ?? 20;
  const items = await prisma.footballPrediction.findMany({
    where: {
      status: "settled",
      ...(q.outcome ? { result: { outcome: q.outcome } } : {}),
    },
    include: { match: { include: { league: true } }, result: true },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}

export async function getStatistics() {
  const total = await prisma.predictionResult.count();
  const wins  = await prisma.predictionResult.count({ where: { outcome: "win" } });
  const losses = await prisma.predictionResult.count({ where: { outcome: "loss" } });
  const voids = await prisma.predictionResult.count({ where: { outcome: "void" } });

  const accuracy = total > 0 ? Math.round((wins / (total - voids)) * 100) : 0;

  const recentResults = await prisma.predictionResult.findMany({
    include: { prediction: { include: { match: { include: { league: true } } } } },
    orderBy: { settledAt: "desc" },
    take: 10,
  });

  return { total, wins, losses, voids, accuracy, recentResults };
}

export async function recordPredictionView(userId: string, predictionId: string) {
  await prisma.userPredictionView.upsert({
    where: { userId_predictionId: { userId, predictionId } },
    create: { userId, predictionId },
    update: { viewedAt: new Date() },
  });
}
