/**
 * Football Routes (user-facing) — Phase 16
 *
 * All read routes require auth.
 * VIP-gated content is enforced server-side based on user subscription.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { db as prisma } from "../../db";
import { getFeatureAccessLevel, canAccessFeature } from "../admin/config/admin.config.service";
import {
  getActiveLeagues,
  getTodaysPredictions,
  getElitePicks,
  getPredictionHistory,
  getStatistics,
  getPublishedPredictions,
  recordPredictionView,
} from "./football.service";
import {
  claimDailyPoints,
  getPointsBalance,
  convertPoints,
} from "./footballPoints.service";

/**
 * Resolve football prediction access for a user.
 *
 * Returns { allowed, isVip } where:
 *   allowed — false when access level is "disabled" (block the request entirely)
 *   isVip   — effective VIP flag to pass to service functions that filter content
 *             When access level is "all", every user receives full (VIP-tier) content.
 *             When access level is "vip"/"staff"/"admin", only VIP/admins get full content.
 */
async function resolveFootballAccess(
  userId: string,
  role: string,
): Promise<{ allowed: boolean; isVip: boolean }> {
  const [sub, level] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    getFeatureAccessLevel("football_prediction"),
  ]);

  const actualVip = !!(sub?.isActive && new Date(sub.endsAt) > new Date());
  const allowed   = canAccessFeature(level, role, actualVip);

  // When the feature is open to all, treat every authenticated user as VIP
  // so the service returns full prediction content (not truncated free-tier content).
  const isVip = level === "all" ? true : actualVip;

  return { allowed, isVip };
}

export async function footballRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/football/leagues
  app.get("/leagues", async (req, reply) => {
    return reply.send({ data: await getActiveLeagues() });
  });

  // GET /api/v1/football/today
  app.get("/today", async (req, reply) => {
    const { allowed, isVip } = await resolveFootballAccess(req.user.sub, req.user.role);
    if (!allowed) {
      return reply.status(403).send({ error: { code: "FEATURE_DISABLED", message: "Football predictions are not available" } });
    }
    return reply.send({ data: await getTodaysPredictions(isVip) });
  });

  // GET /api/v1/football/elite
  app.get("/elite", async (req, reply) => {
    const { allowed, isVip } = await resolveFootballAccess(req.user.sub, req.user.role);
    if (!allowed) {
      return reply.status(403).send({ error: { code: "FEATURE_DISABLED", message: "Football predictions are not available" } });
    }
    return reply.send({ data: await getElitePicks(isVip) });
  });

  // GET /api/v1/football/history
  app.get("/history", async (req, reply) => {
    const q = z.object({
      cursor:  z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(50).default(20),
      outcome: z.enum(["win", "loss", "void"]).optional(),
    }).parse(req.query);
    return reply.send({ data: await getPredictionHistory(q) });
  });

  // GET /api/v1/football/statistics
  app.get("/statistics", async (_req, reply) => {
    return reply.send({ data: await getStatistics() });
  });

  // GET /api/v1/football/predictions
  app.get("/predictions", async (req, reply) => {
    const q = z.object({
      cursor:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(50).default(20),
      leagueId: z.string().optional(),
      isVip:    z.enum(["true", "false"]).transform(v => v === "true").optional(),
    }).parse(req.query);
    return reply.send({ data: await getPublishedPredictions(q) });
  });

  // POST /api/v1/football/predictions/:id/view
  app.post("/predictions/:id/view", async (req, reply) => {
    const { id } = req.params as { id: string };
    await recordPredictionView(req.user.sub, id);
    return reply.send({ data: { ok: true } });
  });

  // ── Phase 20 — Daily Points ───────────────────────────────────────────────

  // POST /api/v1/football/daily-claim — claim today's 25 points
  app.post("/daily-claim", async (req, reply) => {
    const result = await claimDailyPoints(req.user.sub);
    return reply.send({ data: result });
  });

  // GET /api/v1/football/points — current points balance
  app.get("/points", async (req, reply) => {
    const data = await getPointsBalance(req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/football/convert-points — redeem 1000 points for $2 game wallet credit
  app.post("/convert-points", async (req, reply) => {
    const result = await convertPoints(req.user.sub);
    return reply.send({ data: result });
  });
}
