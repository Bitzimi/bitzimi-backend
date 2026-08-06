/**
 * Admin Football Routes — Phase 16
 *
 * Full CRUD management of leagues, matches, predictions, and results.
 * Requires admin.football.view or admin.football.manage permissions.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import {
  adminGetLeagues,
  adminCreateLeague,
  adminUpdateLeague,
  adminDeleteLeague,
  adminGetMatches,
  adminCreateMatch,
  adminUpdateMatch,
  adminDeleteMatch,
  adminGetPredictions,
  adminCreatePrediction,
  adminUpdatePrediction,
  adminPublishPrediction,
  adminDeletePrediction,
  adminSettlePrediction,
  adminGetResults,
  adminGetFootballStats,
} from "./admin.football.service";
import { computeLearningMetrics } from "./ai-learning.service";

export async function adminFootballRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  // Allow empty JSON bodies on PATCH/DELETE routes
  app.addContentTypeParser("application/json", { parseAs: "string" }, function (_req, body, done) {
    if (!body || (body as string).trim() === "") { done(null, {}); return; }
    try { done(null, JSON.parse(body as string)); }
    catch (err) { done(err as Error, undefined); }
  });

  // ── Stats ────────────────────────────────────────────────────────────────────

  app.get("/stats", { onRequest: [requirePermission("admin.football.view")] }, async (_req, reply) => {
    return reply.send({ data: await adminGetFootballStats() });
  });

  // ── Leagues ──────────────────────────────────────────────────────────────────

  app.get("/leagues", { onRequest: [requirePermission("admin.football.view")] }, async (_req, reply) => {
    return reply.send({ data: await adminGetLeagues() });
  });

  app.post("/leagues", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const body = z.object({
      name:      z.string().min(1),
      country:   z.string().min(1),
      logoUrl:   z.string().url().optional(),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    return reply.status(201).send({ data: await adminCreateLeague(body) });
  });

  app.patch("/leagues/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      name:      z.string().min(1).optional(),
      country:   z.string().min(1).optional(),
      logoUrl:   z.string().optional(),
      isActive:  z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    return reply.send({ data: await adminUpdateLeague(id, body) });
  });

  app.delete("/leagues/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await adminDeleteLeague(id);
      return reply.send({ data: { success: true } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "League not found" } });
    }
  });

  // ── Matches ──────────────────────────────────────────────────────────────────

  app.get("/matches", { onRequest: [requirePermission("admin.football.view")] }, async (req, reply) => {
    const q = z.object({
      leagueId: z.string().optional(),
      status:   z.string().optional(),
      cursor:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    return reply.send({ data: await adminGetMatches(q) });
  });

  app.post("/matches", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const body = z.object({
      leagueId:  z.string().min(1),
      homeTeam:  z.string().min(1),
      awayTeam:  z.string().min(1),
      kickoffAt: z.string().min(1),
      venue:     z.string().optional(),
    }).parse(req.body);
    return reply.status(201).send({ data: await adminCreateMatch({ ...body, createdBy: req.user.sub }) });
  });

  app.patch("/matches/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      homeTeam:  z.string().optional(),
      awayTeam:  z.string().optional(),
      kickoffAt: z.string().optional(),
      status:    z.enum(["upcoming", "live", "finished", "postponed", "cancelled"]).optional(),
      venue:     z.string().optional(),
      homeScore: z.number().int().min(0).optional(),
      awayScore: z.number().int().min(0).optional(),
    }).parse(req.body);
    return reply.send({ data: await adminUpdateMatch(id, body) });
  });

  app.delete("/matches/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await adminDeleteMatch(id);
      return reply.send({ data: { success: true } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Match not found" } });
    }
  });

  // ── Predictions ───────────────────────────────────────────────────────────────

  app.get("/predictions", { onRequest: [requirePermission("admin.football.view")] }, async (req, reply) => {
    const q = z.object({
      matchId: z.string().optional(),
      status:  z.string().optional(),
      cursor:  z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    return reply.send({ data: await adminGetPredictions(q) });
  });

  app.post("/predictions", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const body = z.object({
      matchId:    z.string().min(1),
      market:     z.string().min(1),
      prediction: z.string().min(1),
      confidence: z.number().int().min(1).max(100),
      riskLevel:  z.enum(["low", "medium", "high"]).default("medium"),
      isVip:      z.boolean().default(false),
      analysis:   z.string().optional(),
      reasoning:  z.string().optional(),
    }).parse(req.body);
    return reply.status(201).send({ data: await adminCreatePrediction({ ...body, createdBy: req.user.sub }) });
  });

  app.patch("/predictions/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      market:      z.string().optional(),
      prediction:  z.string().optional(),
      confidence:  z.number().int().min(1).max(100).optional(),
      riskLevel:   z.enum(["low", "medium", "high"]).optional(),
      isVip:       z.boolean().optional(),
      analysis:    z.string().optional(),
      reasoning:   z.string().optional(),
      status:      z.enum(["draft", "published", "settled"]).optional(),
      publishedAt: z.string().optional(),
    }).parse(req.body);
    return reply.send({ data: await adminUpdatePrediction(id, body) });
  });

  app.post("/predictions/:id/publish", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await adminPublishPrediction(id) });
  });

  app.delete("/predictions/:id", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await adminDeletePrediction(id);
      return reply.send({ data: { success: true } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Prediction not found" } });
    }
  });

  // ── Results / Settlement ──────────────────────────────────────────────────────

  app.get("/results", { onRequest: [requirePermission("admin.football.view")] }, async (req, reply) => {
    const q = z.object({
      cursor: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    return reply.send({ data: await adminGetResults(q) });
  });

  app.post("/predictions/:id/settle", { onRequest: [requirePermission("admin.football.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      outcome: z.enum(["win", "loss", "void"]),
    }).parse(req.body);
    const result = await adminSettlePrediction(id, body.outcome, req.user.sub);
    // Fire-and-forget: update learning metrics for the current period
    computeLearningMetrics().catch((e: unknown) =>
      console.error("[settle] learning metrics compute failed:", (e as Error).message),
    );
    return reply.send({ data: result });
  });
}
