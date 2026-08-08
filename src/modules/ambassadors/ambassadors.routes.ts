import { FastifyInstance } from "fastify";
import { authenticate }   from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import { db } from "../../db";
import { getFeatureAccessLevel, canAccessFeature } from "../admin/config/admin.config.service";
import {
  applyForAmbassador,
  getMyAmbassadorStatus,
  getAmbassadorActivityScore,
  adminReviewAmbassadorApp,
  adminListAmbassadorApps,
} from "./ambassadors.service";

async function assertAmbassadorAccess(userId: string, role: string): Promise<void> {
  const [sub, level] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    getFeatureAccessLevel("ambassador_program"),
  ]);
  const isVip = !!(sub?.isActive && new Date(sub.endsAt) > new Date());
  if (!canAccessFeature(level, role, isVip)) {
    throw Object.assign(new Error("Ambassador program is not available at your access level"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }
}

// ── User-facing routes (/api/v1/ambassadors) ──────────────────────────────────

export async function ambassadorsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/ambassadors/me
  app.get("/me", async (req, reply) => {
    await assertAmbassadorAccess(req.user.sub, req.user.role);
    const data = await getMyAmbassadorStatus(req.user.sub);
    return reply.send({ data });
  });

  // GET /api/v1/ambassadors/me/score
  app.get("/me/score", async (req, reply) => {
    await assertAmbassadorAccess(req.user.sub, req.user.role);
    const data = await getAmbassadorActivityScore(req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/ambassadors/apply
  app.post<{
    Body: { username: string; bio?: string; socialLinks?: string[] };
  }>("/apply", async (req, reply) => {
    await assertAmbassadorAccess(req.user.sub, req.user.role);
    const { username, bio, socialLinks } = req.body ?? {};
    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "username must be at least 3 characters" } });
    }
    const data = await applyForAmbassador(req.user.sub, { username: username.trim(), bio, socialLinks });
    return reply.status(201).send({ data });
  });
}

// ── Admin routes (/api/v1/admin/ambassadors) ─────────────────────────────────

export async function adminAmbassadorsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/ambassadors?status=pending
  app.get<{ Querystring: { status?: string } }>(
    "/",
    { onRequest: [requirePermission("admin.ambassadors.view")] },
    async (req, reply) => {
      const data = await adminListAmbassadorApps(req.query.status);
      return reply.send({ data });
    },
  );

  // POST /api/v1/admin/ambassadors/:id/review
  app.post<{
    Params: { id: string };
    Body:   { action: "approve" | "reject"; rejectionReason?: string };
  }>(
    "/:id/review",
    { onRequest: [requirePermission("admin.ambassadors.manage")] },
    async (req, reply) => {
      const { action, rejectionReason } = req.body ?? {};
      if (!["approve", "reject"].includes(action)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "action must be approve or reject" } });
      }
      await adminReviewAmbassadorApp(req.params.id, req.user.sub, { action, rejectionReason });
      return reply.send({ data: { success: true } });
    },
  );
}
