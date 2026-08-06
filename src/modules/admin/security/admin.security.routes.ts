/**
 * Security & Audit Routes — Phase 15
 *
 * All routes require authentication.
 * View routes require admin.security.view.
 * Management routes require admin.security.manage.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  getAuditLogs,
  exportAuditLogs,
  getSecurityEvents,
  resolveSecurityEvent,
  getLoginHistory,
  getSessions,
  revokeSession,
  revokeAllUserSessions,
  getIpBlocks,
  createIpBlock,
  deleteIpBlock,
  getFraudAlerts,
  updateFraudAlert,
  getAdminActivity,
  getPermissionAudit,
  getComplianceSummary,
  runFraudScan,
} from "./admin.security.service";

const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
});

const DateRangeSchema = z.object({
  from: z.string().optional(),
  to:   z.string().optional(),
});

export async function adminSecurityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);
  app.addHook("onResponse", auditLogHook);

  // Allow empty JSON bodies on PATCH/DELETE routes — clients may send Content-Type: application/json
  // with no body for bodyless operations (e.g., revoke, resolve).
  app.addContentTypeParser("application/json", { parseAs: "string" }, function (_req, body, done) {
    if (!body || (body as string).trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // ── Audit Logs ─────────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/audit-logs
  app.get(
    "/audit-logs",
    { onRequest: [requirePermission("admin.audit.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(DateRangeSchema).merge(
        z.object({
          actorId:    z.string().optional(),
          targetType: z.string().optional(),
          action:     z.string().optional(),
          ipAddress:  z.string().optional(),
        })
      ).parse(req.query);
      return reply.send({ data: await getAuditLogs(q) });
    },
  );

  // GET /api/v1/admin/security/audit-logs/export
  app.get(
    "/audit-logs/export",
    { onRequest: [requirePermission("admin.audit.view")] },
    async (req, reply) => {
      const q = DateRangeSchema.parse(req.query);
      const rows = await exportAuditLogs(q);

      // Build CSV
      const header = ["id", "timestamp", "actor", "role", "action", "target", "ip", "httpStatus", "metadata"].join(",");
      const escapeCSV = (v: unknown): string => {
        if (v == null) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = rows.map(r =>
        [r.id, r.timestamp, r.actor, r.role, r.action, r.target, r.ip, r.status, r.metadata].map(escapeCSV).join(",")
      );
      const csv = [header, ...lines].join("\n");

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`)
        .send(csv);
    },
  );

  // ── Security Events ────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/events
  app.get(
    "/events",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(DateRangeSchema).merge(
        z.object({
          type:     z.string().optional(),
          severity: z.string().optional(),
          resolved: z.enum(["true", "false"]).transform(v => v === "true").optional(),
        })
      ).parse(req.query);
      return reply.send({ data: await getSecurityEvents(q) });
    },
  );

  // PATCH /api/v1/admin/security/events/:id/resolve
  app.patch(
    "/events/:id/resolve",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const updated = await resolveSecurityEvent(id, req.user.sub);
      if (!updated) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Security event not found" } });
      return reply.send({ data: updated });
    },
  );

  // ── Login History ──────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/login-history
  app.get(
    "/login-history",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(DateRangeSchema).merge(
        z.object({
          userId:  z.string().optional(),
          email:   z.string().optional(),
          success: z.enum(["true", "false"]).transform(v => v === "true").optional(),
        })
      ).parse(req.query);
      return reply.send({ data: await getLoginHistory(q) });
    },
  );

  // ── Session Management ─────────────────────────────────────────────────────

  // GET /api/v1/admin/security/sessions
  app.get(
    "/sessions",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(
        z.object({
          userId: z.string().optional(),
          active: z.enum(["true", "false"]).transform(v => v === "true").optional(),
        })
      ).parse(req.query);
      return reply.send({ data: await getSessions(q) });
    },
  );

  // DELETE /api/v1/admin/security/sessions/:id
  app.delete(
    "/sessions/:id",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await revokeSession(id, req.user.sub);
      if (!result) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return reply.send({ data: { success: true, revokedAt: new Date().toISOString() } });
    },
  );

  // DELETE /api/v1/admin/security/sessions/user/:userId
  app.delete(
    "/sessions/user/:userId",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const result = await revokeAllUserSessions(userId, req.user.sub);
      return reply.send({ data: { success: true, count: result.count } });
    },
  );

  // ── IP Controls ────────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/ip-blocks
  app.get(
    "/ip-blocks",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(
        z.object({ type: z.string().optional() })
      ).parse(req.query);
      return reply.send({ data: await getIpBlocks(q) });
    },
  );

  // POST /api/v1/admin/security/ip-blocks
  app.post(
    "/ip-blocks",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const body = z.object({
        ipAddress: z.string().min(1),
        type:      z.enum(["allow", "block", "temp_block"]),
        reason:    z.string().optional(),
        expiresAt: z.string().optional(),
      }).parse(req.body);

      const result = await createIpBlock({ ...body, createdBy: req.user.sub });
      return reply.status(201).send({ data: result });
    },
  );

  // DELETE /api/v1/admin/security/ip-blocks/:id
  app.delete(
    "/ip-blocks/:id",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        await deleteIpBlock(id);
        return reply.send({ data: { success: true } });
      } catch {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: "IP rule not found" } });
      }
    },
  );

  // ── Fraud Alerts ───────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/fraud-alerts
  app.get(
    "/fraud-alerts",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = PaginationSchema.merge(
        z.object({
          userId:   z.string().optional(),
          severity: z.string().optional(),
          status:   z.string().optional(),
          type:     z.string().optional(),
        })
      ).parse(req.query);
      return reply.send({ data: await getFraudAlerts(q) });
    },
  );

  // PATCH /api/v1/admin/security/fraud-alerts/:id
  app.patch(
    "/fraud-alerts/:id",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        status:     z.enum(["open", "under_review", "resolved", "dismissed"]),
        resolution: z.string().optional(),
      }).parse(req.body);

      const result = await updateFraudAlert(id, { ...body, resolvedBy: req.user.sub });
      return reply.send({ data: result });
    },
  );

  // POST /api/v1/admin/security/fraud-alerts/scan
  app.post(
    "/fraud-alerts/scan",
    { onRequest: [requirePermission("admin.security.manage")] },
    async (_req, reply) => {
      const result = await runFraudScan();
      return reply.send({ data: result });
    },
  );

  // ── Admin Activity ─────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/admin-activity
  app.get(
    "/admin-activity",
    { onRequest: [requirePermission("admin.audit.view")] },
    async (req, reply) => {
      const q = z.object({
        limit:   z.coerce.number().int().min(1).max(500).default(100),
        actorId: z.string().optional(),
      }).parse(req.query);
      return reply.send({ data: await getAdminActivity(q) });
    },
  );

  // ── Permission Audit ───────────────────────────────────────────────────────

  // GET /api/v1/admin/security/permission-audit
  app.get(
    "/permission-audit",
    { onRequest: [requirePermission("admin.audit.view")] },
    async (_req, reply) => {
      return reply.send({ data: await getPermissionAudit() });
    },
  );

  // ── Compliance ─────────────────────────────────────────────────────────────

  // GET /api/v1/admin/security/compliance/summary
  app.get(
    "/compliance/summary",
    { onRequest: [requirePermission("admin.security.view")] },
    async (req, reply) => {
      const q = DateRangeSchema.parse(req.query);
      return reply.send({ data: await getComplianceSummary(q) });
    },
  );
}
