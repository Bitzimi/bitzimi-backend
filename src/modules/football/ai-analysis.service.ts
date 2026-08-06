/**
 * AI Analysis Service — Phase 17.1
 *
 * Manages match analysis records and the prediction queue.
 * The actual AI computation will be implemented in Phase 17.2+.
 * This layer provides the data plumbing and status tracking.
 */

import { db } from "../../db";

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface AnalysisListQuery {
  cursor?:  string;
  limit?:   number;
  status?:  string;
  matchId?: string;
}

export async function getAnalysisList(q: AnalysisListQuery) {
  const limit = Math.min(q.limit ?? 20, 50);
  const where: Record<string, unknown> = {};
  if (q.status)  where.status  = q.status;
  if (q.matchId) where.matchId = q.matchId;

  const items = await db.aIMatchAnalysis.findMany({
    where,
    take:    limit + 1,
    cursor:  q.cursor ? { id: q.cursor } : undefined,
    skip:    q.cursor ? 1 : 0,
    orderBy: { createdAt: "desc" },
    include: {
      match: {
        select: {
          homeTeam: true, awayTeam: true, kickoffAt: true, status: true,
          league: { select: { name: true, country: true } },
        },
      },
    },
  });

  const hasMore    = items.length > limit;
  const page       = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return {
    items: page.map(deserializeAnalysis),
    nextCursor,
    hasMore,
  };
}

export async function getAnalysisForMatch(matchId: string) {
  const a = await db.aIMatchAnalysis.findUnique({
    where:   { matchId },
    include: {
      match: {
        select: {
          homeTeam: true, awayTeam: true, kickoffAt: true, status: true,
          league: { select: { name: true, country: true } },
        },
      },
    },
  });
  return a ? deserializeAnalysis(a) : null;
}

/**
 * Queue a match for AI analysis. The background worker picks it up within 30s.
 * Idempotent — calling again re-queues with high priority (useful for re-triggering).
 */
export async function triggerMatchAnalysis(matchId: string, triggeredBy: string) {
  const match = await db.footballMatch.findUnique({ where: { id: matchId } });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404 });

  const existing = await db.aIMatchAnalysis.findUnique({ where: { matchId } });
  if (existing?.status === "analyzing") {
    throw Object.assign(new Error("Analysis already in progress"), { statusCode: 409 });
  }

  // Reset/create the analysis record to pending so UI shows queued state immediately
  const analysis = await db.aIMatchAnalysis.upsert({
    where:  { matchId },
    create: { matchId, status: "pending" },
    update: { status: "pending", error: null, updatedAt: new Date() },
  });

  // Queue with high priority (8) — worker processes within next 30s poll cycle
  await queueMatchForAnalysis(matchId, 8, triggeredBy);

  return deserializeAnalysis(analysis);
}

/** Retry a failed queue item — resets attempts to 0 and status to "queued". */
export async function retryQueueItem(id: string) {
  const item = await db.aIPredictionQueue.findUnique({ where: { id } });
  if (!item) throw Object.assign(new Error("Queue item not found"), { statusCode: 404 });
  if (item.status !== "failed") {
    throw Object.assign(new Error("Only failed items can be retried"), { statusCode: 409 });
  }
  return db.aIPredictionQueue.update({
    where: { id },
    data:  { status: "queued", attempts: 0, failedAt: null, error: null, scheduledAt: new Date() },
  });
}

function deserializeAnalysis(a: {
  id: string; matchId: string; status: string;
  features?: string | null; confidenceData?: string | null;
  reasoning?: string | null; analysis?: string | null;
  suggestedMarket?: string | null; suggestedPrediction?: string | null;
  suggestedConfidence?: number | null; suggestedRiskLevel?: string | null;
  suggestedIsVip: boolean; modelVersion?: string | null;
  processingMs?: number | null; error?: string | null;
  createdAt: Date; updatedAt: Date;
  match?: unknown;
}) {
  return {
    ...a,
    features:       a.features       ? JSON.parse(a.features)       : null,
    confidenceData: a.confidenceData ? JSON.parse(a.confidenceData) : null,
  };
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface QueueQuery {
  cursor?:   string;
  limit?:    number;
  status?:   string;
}

export async function getQueue(q: QueueQuery = {}) {
  const limit = Math.min(q.limit ?? 20, 100);
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;

  const items = await db.aIPredictionQueue.findMany({
    where,
    take:    limit + 1,
    cursor:  q.cursor ? { id: q.cursor } : undefined,
    skip:    q.cursor ? 1 : 0,
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
    include: {
      match: {
        select: {
          homeTeam: true, awayTeam: true, kickoffAt: true, status: true,
          league: { select: { name: true, country: true } },
        },
      },
    },
  });

  const hasMore    = items.length > limit;
  const page       = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const totals = await db.aIPredictionQueue.groupBy({
    by:     ["status"],
    _count: true,
  });
  const statusCounts: Record<string, number> = {};
  for (const t of totals) statusCounts[t.status] = t._count;

  return { items: page, nextCursor, hasMore, statusCounts };
}

export async function queueMatchForAnalysis(
  matchId:  string,
  priority: number,
  queuedBy: string,
) {
  const match = await db.footballMatch.findUnique({ where: { id: matchId } });
  if (!match) throw Object.assign(new Error("Match not found"), { statusCode: 404 });

  // Idempotent: if already queued/processing, update priority only
  const existing = await db.aIPredictionQueue.findFirst({
    where: { matchId, status: { in: ["queued", "processing"] } },
  });

  if (existing) {
    return db.aIPredictionQueue.update({
      where: { id: existing.id },
      data:  { priority },
    });
  }

  return db.aIPredictionQueue.create({
    data: { matchId, priority, queuedBy },
  });
}

export async function removeFromQueue(id: string) {
  const item = await db.aIPredictionQueue.findUnique({ where: { id } });
  if (!item) throw Object.assign(new Error("Queue item not found"), { statusCode: 404 });
  if (item.status === "processing") {
    throw Object.assign(new Error("Cannot remove an item that is currently processing"), { statusCode: 409 });
  }
  await db.aIPredictionQueue.delete({ where: { id } });
  return { success: true };
}

export async function getQueueStats() {
  const [total, queued, processing, completed, failed] = await Promise.all([
    db.aIPredictionQueue.count(),
    db.aIPredictionQueue.count({ where: { status: "queued" } }),
    db.aIPredictionQueue.count({ where: { status: "processing" } }),
    db.aIPredictionQueue.count({ where: { status: "completed" } }),
    db.aIPredictionQueue.count({ where: { status: "failed" } }),
  ]);
  return { total, queued, processing, completed, failed };
}
