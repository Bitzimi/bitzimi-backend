/**
 * AI Prediction Generation Service — Phase 17.3
 *
 * Reads completed AIMatchAnalysis records and creates FootballPrediction
 * records in "ai_review" status. All generated predictions stay in review
 * until an admin explicitly approves, edits, and publishes them.
 *
 * No prediction is ever auto-published by this service.
 * All business logic (duplicate guards, status transitions) lives here on
 * the backend — the frontend receives pre-computed results only.
 */

import { db } from "../../db";

// ── Edit shape shared across approve / publish / patch ────────────────────────

export interface PredictionEdits {
  market?:     string;
  prediction?: string;
  confidence?: number;
  riskLevel?:  string;
  isVip?:      boolean;
  analysis?:   string;
  reasoning?:  string;
}

// ── Generate ──────────────────────────────────────────────────────────────────

/**
 * Creates a draft FootballPrediction from a completed AIMatchAnalysis.
 * The prediction is placed in "ai_review" status and must be explicitly
 * approved/published by an admin — it is never visible to users at this point.
 *
 * Duplicate guard: rejects if a published or pending-review prediction already
 * exists for this match.
 */
export async function generatePredictionFromAnalysis(
  matchId: string,
  generatedBy: string,
) {
  const analysis = await db.aIMatchAnalysis.findUnique({
    where:   { matchId },
    include: { match: { include: { league: true } } },
  });

  if (!analysis) {
    throw Object.assign(
      new Error("No analysis found for this match. Trigger analysis first."),
      { statusCode: 404 },
    );
  }
  if (analysis.status !== "completed") {
    throw Object.assign(
      new Error(`Analysis is not completed (status: ${analysis.status}). Wait for the worker to finish.`),
      { statusCode: 409 },
    );
  }
  if (!analysis.suggestedMarket || !analysis.suggestedPrediction || analysis.suggestedConfidence == null) {
    throw Object.assign(
      new Error("Analysis is missing suggestion data. Re-trigger analysis."),
      { statusCode: 422 },
    );
  }

  // Duplicate guard — one published prediction per match, one pending review per match
  const existing = await db.footballPrediction.findFirst({
    where: { matchId, status: { in: ["published", "ai_review"] } },
  });

  if (existing?.status === "published") {
    throw Object.assign(
      new Error("A published prediction already exists for this match. Settle or delete it before generating a new one."),
      { statusCode: 409 },
    );
  }
  if (existing?.status === "ai_review") {
    throw Object.assign(
      new Error("An AI prediction is already pending review for this match. Review or reject it first."),
      { statusCode: 409 },
    );
  }

  return db.footballPrediction.create({
    data: {
      matchId,
      market:      analysis.suggestedMarket,
      prediction:  analysis.suggestedPrediction,
      confidence:  analysis.suggestedConfidence,
      riskLevel:   analysis.suggestedRiskLevel ?? "medium",
      isVip:       analysis.suggestedIsVip,
      analysis:    analysis.analysis,
      reasoning:   analysis.reasoning,
      status:      "ai_review",
      aiGenerated: true,
      createdBy:   generatedBy,
    },
    include: { match: { include: { league: true } } },
  });
}

// ── List ──────────────────────────────────────────────────────────────────────

export interface AiPredListQuery {
  status?:  string;
  cursor?:  string;
  limit?:   number;
}

export async function listAiPredictions(q: AiPredListQuery = {}) {
  const limit = Math.min(q.limit ?? 20, 50);
  const where: Record<string, unknown> = { aiGenerated: true };
  if (q.status) where.status = q.status;

  const items = await db.footballPrediction.findMany({
    where,
    include: { match: { include: { league: true } }, result: true },
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  q.cursor ? { id: q.cursor } : undefined,
    skip:    q.cursor ? 1 : 0,
  });

  const hasMore    = items.length > limit;
  const page       = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const [reviewCount, draftCount, publishedCount, rejectedCount] = await Promise.all([
    db.footballPrediction.count({ where: { aiGenerated: true, status: "ai_review" } }),
    db.footballPrediction.count({ where: { aiGenerated: true, status: "draft" } }),
    db.footballPrediction.count({ where: { aiGenerated: true, status: "published" } }),
    db.footballPrediction.count({ where: { aiGenerated: true, status: "rejected" } }),
  ]);

  return {
    items: page,
    nextCursor,
    hasMore,
    counts: { review: reviewCount, draft: draftCount, published: publishedCount, rejected: rejectedCount },
  };
}

// ── Single ────────────────────────────────────────────────────────────────────

export async function getAiPrediction(id: string) {
  const p = await db.footballPrediction.findUnique({
    where:   { id },
    include: { match: { include: { league: true } }, result: true },
  });
  if (!p) throw Object.assign(new Error("Prediction not found"), { statusCode: 404 });
  if (!p.aiGenerated) throw Object.assign(new Error("Not an AI-generated prediction"), { statusCode: 400 });
  return p;
}

// ── Patch (edit in place, no status change) ───────────────────────────────────

export async function patchAiPrediction(id: string, edits: PredictionEdits) {
  const p = await db.footballPrediction.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Prediction not found"), { statusCode: 404 });
  if (!p.aiGenerated) throw Object.assign(new Error("Not an AI-generated prediction"), { statusCode: 400 });
  if (p.status === "published" || p.status === "settled") {
    throw Object.assign(new Error("Cannot edit a published or settled prediction"), { statusCode: 409 });
  }

  return db.footballPrediction.update({
    where:   { id },
    data:    edits,
    include: { match: { include: { league: true } } },
  });
}

// ── Approve (ai_review → draft) ───────────────────────────────────────────────

export async function approveAiPrediction(id: string, edits: PredictionEdits) {
  const p = await db.footballPrediction.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Prediction not found"), { statusCode: 404 });
  if (p.status !== "ai_review") {
    throw Object.assign(new Error("Only ai_review predictions can be approved"), { statusCode: 409 });
  }

  return db.footballPrediction.update({
    where:   { id },
    data:    { ...edits, status: "draft" },
    include: { match: { include: { league: true } } },
  });
}

// ── Publish (ai_review | draft → published) ───────────────────────────────────

export async function publishAiPrediction(id: string, edits: PredictionEdits) {
  const p = await db.footballPrediction.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Prediction not found"), { statusCode: 404 });
  if (!["ai_review", "draft"].includes(p.status)) {
    throw Object.assign(
      new Error("Only ai_review or draft predictions can be published"),
      { statusCode: 409 },
    );
  }

  // Duplicate guard: another published prediction for this match?
  const conflict = await db.footballPrediction.findFirst({
    where: { matchId: p.matchId, status: "published", id: { not: id } },
  });
  if (conflict) {
    throw Object.assign(
      new Error("Another published prediction already exists for this match."),
      { statusCode: 409 },
    );
  }

  return db.footballPrediction.update({
    where:   { id },
    data:    { ...edits, status: "published", publishedAt: new Date() },
    include: { match: { include: { league: true } } },
  });
}

// ── Reject (ai_review | draft → rejected) ────────────────────────────────────

export async function rejectAiPrediction(id: string) {
  const p = await db.footballPrediction.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Prediction not found"), { statusCode: 404 });
  if (!["ai_review", "draft"].includes(p.status)) {
    throw Object.assign(
      new Error("Only ai_review or draft predictions can be rejected"),
      { statusCode: 409 },
    );
  }

  return db.footballPrediction.update({
    where:   { id },
    data:    { status: "rejected" },
    include: { match: { include: { league: true } } },
  });
}

// ── Check if a match already has an AI prediction ─────────────────────────────

export async function getMatchAiPrediction(matchId: string) {
  return db.footballPrediction.findFirst({
    where:   { matchId, aiGenerated: true },
    include: { match: { include: { league: true } }, result: true },
    orderBy: { createdAt: "desc" },
  });
}
