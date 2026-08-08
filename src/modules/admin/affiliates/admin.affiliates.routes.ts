import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  listAffiliateApplications,
  approveAffiliateApplication,
  rejectAffiliateApplication,
  adminGetAffiliateStats,
  adminListAffiliateCommissions,
  adminGetTopAffiliateEarners,
  adminGetCommissionJobs,
  adminGetCommissionAnalytics,
} from "./admin.affiliates.service";

export async function adminAffiliatesRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // ── Applications ─────────────────────────────────────────────────────────────

  // GET /api/v1/admin/affiliates/applications
  app.get("/applications", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await listAffiliateApplications(query);
    return reply.send({ data });
  });

  // POST /api/v1/admin/affiliates/applications/:id/approve
  app.post("/applications/:id/approve", { onRequest: [requirePermission("admin.affiliates.approve")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await approveAffiliateApplication(id, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/affiliates/applications/:id/reject
  app.post("/applications/:id/reject", { onRequest: [requirePermission("admin.affiliates.reject")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body   = z.object({
      reason: z.string().min(1, "Rejection reason is required").max(500),
    }).parse(req.body);
    const data = await rejectAffiliateApplication(id, req.user.sub, body.reason);
    return reply.send({ data });
  });

  // ── Statistics ────────────────────────────────────────────────────────────────

  // GET /api/v1/admin/affiliates/stats
  app.get("/stats", { onRequest: [requirePermission("admin.referrals.view")] }, async (_req, reply) => {
    const data = await adminGetAffiliateStats();
    return reply.send({ data });
  });

  // GET /api/v1/admin/affiliates/analytics
  app.get("/analytics", { onRequest: [requirePermission("admin.referrals.view")] }, async (_req, reply) => {
    const data = await adminGetCommissionAnalytics();
    return reply.send({ data });
  });

  // GET /api/v1/admin/affiliates/top-earners
  app.get("/top-earners", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({ limit: z.string().transform(Number).optional() }).parse(req.query);
    const data  = await adminGetTopAffiliateEarners(query.limit ?? 20);
    return reply.send({ data });
  });

  // ── Commissions ───────────────────────────────────────────────────────────────

  // GET /api/v1/admin/affiliates/commissions
  app.get("/commissions", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({
      eventType:    z.string().optional(),
      tier:         z.string().transform(Number).optional(),
      beneficiaryId: z.string().optional(),
      sourceUserId:  z.string().optional(),
      cursor:        z.string().optional(),
      limit:         z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListAffiliateCommissions(query);
    return reply.send({ data });
  });

  // ── Commission job queue ──────────────────────────────────────────────────────

  // GET /api/v1/admin/affiliates/jobs
  app.get("/jobs", { onRequest: [requirePermission("admin.referrals.view")] }, async (req, reply) => {
    const query = z.object({
      status: z.string().optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminGetCommissionJobs(query);
    return reply.send({ data });
  });
}
