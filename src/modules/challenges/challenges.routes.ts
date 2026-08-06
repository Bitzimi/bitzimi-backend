import { FastifyInstance } from "fastify";
import { authenticate }      from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import { getFeatureAccessLevel, canAccessFeature } from "../admin/config/admin.config.service";
import {
  getCurrentChallengeLeaderboard,
  getUserLevelLeaderboard,
  adminCreateChallenge,
  adminActivateChallenge,
  adminEndAndDistributeChallenge,
  adminListChallenges,
  adminGrantVip,
} from "./challenges.service";
import { db } from "../../db";

async function assertChallengeAccess(userId: string, role: string): Promise<void> {
  const [sub, level] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    getFeatureAccessLevel("monthly_challenge"),
  ]);
  const isVip = !!(sub?.isActive && new Date(sub.endsAt) > new Date());
  if (!canAccessFeature(level, role, isVip)) {
    throw Object.assign(new Error("Monthly challenge is not available at your access level"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }
}

// ── User-facing routes (/api/v1/challenges) ───────────────────────────────────

export async function challengesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  /**
   * GET /api/v1/challenges/leaderboard
   *
   * Returns ONLY the leaderboard for the authenticated user's own program level.
   * Backend auto-determines level — no client-side selection permitted.
   * Admin sees all three boards via the admin endpoint below.
   */
  app.get("/leaderboard", async (req, reply) => {
    await assertChallengeAccess(req.user.sub, req.user.role);
    const user = await db.user.findUnique({
      where:  { id: req.user.sub },
      select: { programLevel: true },
    });
    const level = (user?.programLevel ?? "referral") as "referral" | "affiliate" | "ambassador";
    const data  = await getUserLevelLeaderboard(level);
    return reply.send({ data });
  });
}

// ── Admin routes (/api/v1/admin/challenges) ───────────────────────────────────

export async function adminChallengesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/challenges
  app.get(
    "/",
    { onRequest: [requirePermission("admin.challenges.view")] },
    async (_req, reply) => {
      const data = await adminListChallenges();
      return reply.send({ data });
    },
  );

  /**
   * GET /api/v1/admin/challenges/leaderboard
   * Admin-only — returns all three leaderboards simultaneously.
   */
  app.get(
    "/leaderboard",
    { onRequest: [requirePermission("admin.challenges.view")] },
    async (_req, reply) => {
      const data = await getCurrentChallengeLeaderboard();
      return reply.send({ data });
    },
  );

  // POST /api/v1/admin/challenges
  app.post<{
    Body: {
      title:          string;
      description?:   string;
      period:         string;
      startAt:        string;
      endAt:          string;
      referralPool?:  number;
      referralTopN?:  number;
      affiliatePool?: number;
      affiliateTopN?: number;
      ambassadorPool?:number;
      ambassadorTopN?:number;
    };
  }>(
    "/",
    { onRequest: [requirePermission("admin.challenges.manage")] },
    async (req, reply) => {
      const { title, description, period, startAt, endAt, ...pools } = req.body ?? {};
      if (!title || !period || !startAt || !endAt) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "title, period, startAt, endAt required" } });
      }
      const data = await adminCreateChallenge({ title, description, period, startAt, endAt, ...pools });
      return reply.status(201).send({ data });
    },
  );

  // PATCH /api/v1/admin/challenges/:id/activate
  app.patch<{ Params: { id: string } }>(
    "/:id/activate",
    { onRequest: [requirePermission("admin.challenges.manage")] },
    async (req, reply) => {
      const data = await adminActivateChallenge(req.params.id);
      return reply.send({ data });
    },
  );

  // POST /api/v1/admin/challenges/:id/end — end + distribute all pools + VIP grants
  app.post<{ Params: { id: string } }>(
    "/:id/end",
    { onRequest: [requirePermission("admin.challenges.manage")] },
    async (req, reply) => {
      const result = await adminEndAndDistributeChallenge(req.params.id, req.user.sub);
      return reply.send({ data: result });
    },
  );

  // POST /api/v1/admin/challenges/vip-grant — manual VIP grant to any user
  app.post<{
    Body: { userId: string; durationDays: number; reason?: string };
  }>(
    "/vip-grant",
    { onRequest: [requirePermission("admin.challenges.manage")] },
    async (req, reply) => {
      const { userId, durationDays, reason } = req.body ?? {};
      if (!userId || !durationDays || durationDays < 1) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "userId and durationDays (min 1) required" } });
      }
      await adminGrantVip({ userId, durationDays, grantedBy: req.user.sub, reason });
      return reply.send({ data: { success: true, durationDays } });
    },
  );
}
