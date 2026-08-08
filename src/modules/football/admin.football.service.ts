/**
 * Admin Football Service — Phase 16
 *
 * Full CRUD for leagues, matches, predictions, and result settlement.
 */

import { db as prisma } from "../../db";

// ── Leagues ───────────────────────────────────────────────────────────────────

export async function adminGetLeagues() {
  return prisma.footballLeague.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function adminCreateLeague(data: { name: string; country: string; logoUrl?: string; sortOrder?: number }) {
  return prisma.footballLeague.create({ data });
}

export async function adminUpdateLeague(id: string, data: Partial<{ name: string; country: string; logoUrl: string; isActive: boolean; sortOrder: number }>) {
  return prisma.footballLeague.update({ where: { id }, data });
}

export async function adminDeleteLeague(id: string) {
  return prisma.footballLeague.delete({ where: { id } });
}

// ── Matches ───────────────────────────────────────────────────────────────────

interface MatchListQuery { leagueId?: string; status?: string; cursor?: string; limit?: number }

export async function adminGetMatches(q: MatchListQuery) {
  const limit = q.limit ?? 50;
  const items = await prisma.footballMatch.findMany({
    where: {
      ...(q.leagueId ? { leagueId: q.leagueId } : {}),
      ...(q.status   ? { status: q.status }       : {}),
    },
    include: { league: true, predictions: { select: { id: true, status: true, isVip: true } } },
    orderBy: { kickoffAt: "desc" },
    take: limit + 1,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}

export async function adminCreateMatch(data: {
  leagueId: string; homeTeam: string; awayTeam: string;
  kickoffAt: string; venue?: string; createdBy: string;
}) {
  return prisma.footballMatch.create({
    data: {
      leagueId:  data.leagueId,
      homeTeam:  data.homeTeam,
      awayTeam:  data.awayTeam,
      kickoffAt: new Date(data.kickoffAt),
      venue:     data.venue,
      createdBy: data.createdBy,
    },
    include: { league: true },
  });
}

export async function adminUpdateMatch(id: string, data: Partial<{
  homeTeam: string; awayTeam: string; kickoffAt: string; status: string;
  venue: string; homeScore: number; awayScore: number;
}>) {
  return prisma.footballMatch.update({
    where: { id },
    data: {
      ...data,
      ...(data.kickoffAt ? { kickoffAt: new Date(data.kickoffAt) } : {}),
    },
    include: { league: true },
  });
}

export async function adminDeleteMatch(id: string) {
  return prisma.footballMatch.delete({ where: { id } });
}

// ── Predictions ───────────────────────────────────────────────────────────────

interface PredListQuery { matchId?: string; status?: string; cursor?: string; limit?: number }

export async function adminGetPredictions(q: PredListQuery) {
  const limit = q.limit ?? 50;
  const items = await prisma.footballPrediction.findMany({
    where: {
      ...(q.matchId ? { matchId: q.matchId } : {}),
      ...(q.status  ? { status: q.status }   : {}),
    },
    include: { match: { include: { league: true } }, result: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}

export async function adminCreatePrediction(data: {
  matchId: string; market: string; prediction: string;
  confidence: number; riskLevel: string; isVip: boolean;
  analysis?: string; reasoning?: string; createdBy: string;
}) {
  return prisma.footballPrediction.create({
    data: {
      matchId:    data.matchId,
      market:     data.market,
      prediction: data.prediction,
      confidence: data.confidence,
      riskLevel:  data.riskLevel,
      isVip:      data.isVip,
      analysis:   data.analysis,
      reasoning:  data.reasoning,
      createdBy:  data.createdBy,
    },
    include: { match: { include: { league: true } } },
  });
}

export async function adminUpdatePrediction(id: string, data: Partial<{
  market: string; prediction: string; confidence: number; riskLevel: string;
  isVip: boolean; analysis: string; reasoning: string; status: string; publishedAt: string;
}>) {
  return prisma.footballPrediction.update({
    where: { id },
    data: {
      ...data,
      ...(data.publishedAt ? { publishedAt: new Date(data.publishedAt) } : {}),
    },
    include: { match: { include: { league: true } }, result: true },
  });
}

export async function adminPublishPrediction(id: string) {
  return prisma.footballPrediction.update({
    where: { id },
    data: { status: "published", publishedAt: new Date() },
    include: { match: { include: { league: true } } },
  });
}

export async function adminDeletePrediction(id: string) {
  return prisma.footballPrediction.delete({ where: { id } });
}

// ── Results / Settlement ──────────────────────────────────────────────────────

export async function adminSettlePrediction(predictionId: string, outcome: "win" | "loss" | "void", settledBy: string) {
  const isCorrect = outcome === "win";

  const result = await prisma.predictionResult.upsert({
    where: { predictionId },
    create: { predictionId, outcome, isCorrect, settledBy },
    update: { outcome, isCorrect, settledBy, settledAt: new Date() },
  });

  await prisma.footballPrediction.update({
    where: { id: predictionId },
    data: { status: "settled" },
  });

  return result;
}

export async function adminGetResults(q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const items = await prisma.predictionResult.findMany({
    include: { prediction: { include: { match: { include: { league: true } } } } },
    orderBy: { settledAt: "desc" },
    take: limit + 1,
    cursor: q.cursor ? { id: q.cursor } : undefined,
    skip: q.cursor ? 1 : 0,
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}

export async function adminGetFootballStats() {
  const [leagues, matches, predictions, results, published, settled] = await Promise.all([
    prisma.footballLeague.count(),
    prisma.footballMatch.count(),
    prisma.footballPrediction.count(),
    prisma.predictionResult.count(),
    prisma.footballPrediction.count({ where: { status: "published" } }),
    prisma.footballPrediction.count({ where: { status: "settled" } }),
  ]);

  const wins  = await prisma.predictionResult.count({ where: { outcome: "win" } });
  const total = await prisma.predictionResult.count({ where: { outcome: { in: ["win", "loss"] } } });
  const accuracy = total > 0 ? Math.round((wins / total) * 100) : 0;

  return { leagues, matches, predictions, results, published, settled, accuracy, wins, total };
}
