import { FastifyInstance } from "fastify";
import { authenticate }      from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import {
  adminListPromotions,
  adminGetPromotionDetail,
  adminCreatePlatformPromotion,
  adminUpdatePromotion,
  adminActivatePromotion,
  adminPausePromotion,
  adminExpirePromotion,
  adminCancelPromotion,
  adminSetPromotionPlacements,
  adminSetPromotionSchedule,
  adminAddEventLink,
  adminRemoveEventLink,
  adminGetStatusHistory,
  adminListFeaturedRequests,
  adminApproveFeaturedRequest,
  adminRejectFeaturedRequest,
  getFeaturedPricing,
  updateFeaturedPricing,
  adminGetFeaturedRevenue,
} from "./promotions.service";

export async function adminPromotionsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // ── Revenue (most restrictive — checked first to avoid param route clash) ─────

  // GET /api/v1/admin/promotions/revenue
  app.get(
    "/revenue",
    { onRequest: [requirePermission("admin.promotions.revenue")] },
    async (_req, reply) => {
      const data = await adminGetFeaturedRevenue();
      return reply.send({ data });
    },
  );

  // ── Pricing ──────────────────────────────────────────────────────────────────

  // GET /api/v1/admin/promotions/pricing
  app.get(
    "/pricing",
    { onRequest: [requirePermission("admin.promotions.view")] },
    async (_req, reply) => {
      const data = await getFeaturedPricing();
      return reply.send({ data });
    },
  );

  // PUT /api/v1/admin/promotions/pricing/:days
  app.put<{ Params: { days: string }; Body: { price: number } }>(
    "/pricing/:days",
    { onRequest: [requirePermission("admin.promotions.featured.approve")] },
    async (req, reply) => {
      const days  = parseInt(req.params.days, 10);
      const { price } = req.body ?? {};
      if (!price || price <= 0) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "price must be a positive number" } });
      }
      const data = await updateFeaturedPricing(days, price, req.user.sub);
      return reply.send({ data });
    },
  );

  // ── Featured requests ─────────────────────────────────────────────────────────

  // GET /api/v1/admin/promotions/featured
  app.get<{ Querystring: { status?: string } }>(
    "/featured",
    { onRequest: [requirePermission("admin.promotions.view")] },
    async (req, reply) => {
      const data = await adminListFeaturedRequests({ status: req.query.status });
      return reply.send({ data });
    },
  );

  // POST /api/v1/admin/promotions/featured/:id/approve
  app.post<{ Params: { id: string } }>(
    "/featured/:id/approve",
    { onRequest: [requirePermission("admin.promotions.featured.approve")] },
    async (req, reply) => {
      await adminApproveFeaturedRequest(req.params.id, req.user.sub);
      return reply.send({ data: { success: true } });
    },
  );

  // POST /api/v1/admin/promotions/featured/:id/reject
  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    "/featured/:id/reject",
    { onRequest: [requirePermission("admin.promotions.featured.approve")] },
    async (req, reply) => {
      const { reason } = req.body ?? {};
      if (!reason) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "reason is required" } });
      }
      await adminRejectFeaturedRequest(req.params.id, req.user.sub, reason);
      return reply.send({ data: { success: true } });
    },
  );

  // ── Promotions CRUD ──────────────────────────────────────────────────────────

  // GET /api/v1/admin/promotions
  app.get<{ Querystring: { status?: string; type?: string } }>(
    "/",
    { onRequest: [requirePermission("admin.promotions.view")] },
    async (req, reply) => {
      const data = await adminListPromotions({ status: req.query.status, type: req.query.type });
      return reply.send({ data });
    },
  );

  // POST /api/v1/admin/promotions
  app.post<{
    Body: {
      title:        string;
      description?: string;
      ctaLabel?:    string;
      ctaUrl?:      string;
      imageUrl?:    string;
      badgeLabel?:  string;
      badgeColor?:  string;
      accentColor?: string;
      priority?:    number;
      locations:    string[];
      startsAt?:    string;
      endsAt?:      string;
    };
  }>(
    "/",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const { title, locations, ...rest } = req.body ?? {};
      if (!title) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "title is required" } });
      }
      if (!locations || !Array.isArray(locations) || locations.length === 0) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "locations must be a non-empty array" } });
      }
      const data = await adminCreatePlatformPromotion(req.user.sub, { title, locations: locations as any, ...rest });
      return reply.status(201).send({ data });
    },
  );

  // GET /api/v1/admin/promotions/:id
  app.get<{ Params: { id: string } }>(
    "/:id",
    { onRequest: [requirePermission("admin.promotions.view")] },
    async (req, reply) => {
      const data = await adminGetPromotionDetail(req.params.id);
      return reply.send({ data });
    },
  );

  // PUT /api/v1/admin/promotions/:id
  app.put<{
    Params: { id: string };
    Body: Partial<{
      title:       string;
      description: string;
      ctaLabel:    string;
      ctaUrl:      string;
      imageUrl:    string;
      badgeLabel:  string;
      badgeColor:  string;
      accentColor: string;
      priority:    number;
      startsAt:    string;
      endsAt:      string;
    }>;
  }>(
    "/:id",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const data = await adminUpdatePromotion(req.params.id, req.user.sub, req.body ?? {});
      return reply.send({ data });
    },
  );

  // DELETE /api/v1/admin/promotions/:id
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      await adminCancelPromotion(req.params.id, req.user.sub);
      return reply.send({ data: { success: true } });
    },
  );

  // ── Status transitions ───────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    "/:id/activate",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const data = await adminActivatePromotion(req.params.id, req.user.sub);
      return reply.send({ data });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/pause",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const data = await adminPausePromotion(req.params.id, req.user.sub);
      return reply.send({ data });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/expire",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const data = await adminExpirePromotion(req.params.id, req.user.sub);
      return reply.send({ data });
    },
  );

  // ── Placements ───────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { locations: string[] } }>(
    "/:id/placements",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const { locations } = req.body ?? {};
      if (!Array.isArray(locations)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "locations must be an array" } });
      }
      const data = await adminSetPromotionPlacements(req.params.id, locations as any);
      return reply.send({ data });
    },
  );

  // ── Schedule ─────────────────────────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: { startsAt: string; endsAt: string; timeZone?: string; autoActivate?: boolean; autoExpire?: boolean };
  }>(
    "/:id/schedule",
    { onRequest: [requirePermission("admin.promotions.manage")] },
    async (req, reply) => {
      const { startsAt, endsAt, ...rest } = req.body ?? {};
      if (!startsAt || !endsAt) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "startsAt and endsAt are required" } });
      }
      const data = await adminSetPromotionSchedule(req.params.id, req.user.sub, { startsAt, endsAt, ...rest });
      return reply.send({ data });
    },
  );

  // ── Event links ──────────────────────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: { eventType: string; eventId?: string; metadata?: Record<string, unknown> };
  }>(
    "/:id/event-link",
    { onRequest: [requirePermission("admin.promotions.featured.approve")] },
    async (req, reply) => {
      const { eventType, ...rest } = req.body ?? {};
      if (!eventType) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "eventType is required" } });
      }
      const data = await adminAddEventLink(req.params.id, req.user.sub, { eventType, ...rest });
      return reply.status(201).send({ data });
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>(
    "/:id/event-link/:linkId",
    { onRequest: [requirePermission("admin.promotions.featured.approve")] },
    async (req, reply) => {
      await adminRemoveEventLink(req.params.linkId);
      return reply.send({ data: { success: true } });
    },
  );

  // ── Status history ───────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/:id/history",
    { onRequest: [requirePermission("admin.promotions.view")] },
    async (req, reply) => {
      const data = await adminGetStatusHistory(req.params.id);
      return reply.send({ data });
    },
  );
}
