/**
 * AI Developer Center — API Routes — Phase 14.1
 *
 * Registers the real project scanning API under /api/v1/admin/developer.
 * All routes require authentication + admin.developer.view permission.
 * The POST /scan route additionally requires admin.developer.scan.
 *
 * NO AI calls. NO internet. NO filesystem writes. Pattern-based scanning only.
 */

import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  triggerScan,
  getIssues,
  getIssueById,
  updateIssue,
  getScanHistory,
  getScanProgress,
  getIssueSummary,
  getSystemHealth,
  getAnalysisHistory,
  generatePatchForIssue,
  getPatchForIssue,
  getPatch,
  approvePatchById,
  rejectPatchById,
  getPatchAuditHistory,
  validatePatch,
  type ScanType,
} from "./admin.developer.service";

const SCAN_TYPES = ["full", "deep", "frontend", "backend", "database", "api", "integrations"] as const;

export async function adminDeveloperRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);
  app.addHook("onResponse", auditLogHook);

  // ── GET /issues ───────────────────────────────────────────────────────────
  app.get(
    "/issues",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      return reply.send({ data: getIssues() });
    },
  );

  // ── GET /issues/:id ───────────────────────────────────────────────────────
  app.get(
    "/issues/:id",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const issue = getIssueById(id);
      if (!issue) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Issue ${id} not found` } });
      }
      return reply.send({ data: issue });
    },
  );

  // ── PATCH /issues/:id ─────────────────────────────────────────────────────
  app.patch(
    "/issues/:id",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          status: z.enum(["open", "under_review", "resolved", "wont_fix", "verified"]).optional(),
          verificationStatus: z.enum(["unverified", "under_review", "verified", "false_positive", "closed"]).optional(),
        })
        .parse(req.body);

      const updated = updateIssue(id, body);
      if (!updated) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Issue ${id} not found` } });
      }
      return reply.send({ data: updated });
    },
  );

  // ── GET /summary ──────────────────────────────────────────────────────────
  app.get(
    "/summary",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      return reply.send({ data: getIssueSummary() });
    },
  );

  // ── GET /health ───────────────────────────────────────────────────────────
  app.get(
    "/health",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      return reply.send({ data: getSystemHealth() });
    },
  );

  // ── GET /scan-history ─────────────────────────────────────────────────────
  app.get(
    "/scan-history",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      return reply.send({ data: getScanHistory() });
    },
  );

  // ── GET /scan/:scanId ─────────────────────────────────────────────────────
  // Polling endpoint: client polls this to observe scan progress.
  app.get(
    "/scan/:scanId",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { scanId } = req.params as { scanId: string };
      const progress = getScanProgress(scanId);
      if (!progress) {
        return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Scan ${scanId} not found` } });
      }
      return reply.send({ data: progress });
    },
  );

  // ── GET /analysis/history ─────────────────────────────────────────────────
  app.get(
    "/analysis/history",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      const items = getAnalysisHistory();
      return reply.send({ data: { items, total: items.length } });
    },
  );

  // ── POST /patches/generate ───────────────────────────────────────────────
  // Generate a real deterministic patch for the given issueId.
  app.post(
    "/patches/generate",
    { onRequest: [requirePermission("admin.developer.patch")] },
    async (req, reply) => {
      const body = z.object({ issueId: z.string() }).parse(req.body);
      const patch = generatePatchForIssue(body.issueId);
      if (!patch) {
        return reply.status(404).send({
          error: {
            code: "PATCH_UNAVAILABLE",
            message:
              `No patch can be generated for issue ${body.issueId}. ` +
              "Either the issue does not exist, has not been scanned yet, or its " +
              "detector type does not support automated patch generation.",
          },
        });
      }
      return reply.send({ data: patch });
    },
  );

  // ── GET /patches/by-issue/:issueId ────────────────────────────────────────
  app.get(
    "/patches/by-issue/:issueId",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { issueId } = req.params as { issueId: string };
      const patch = getPatchForIssue(issueId);
      if (!patch) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `No patch found for issue ${issueId}` },
        });
      }
      return reply.send({ data: patch });
    },
  );

  // ── GET /patches/:patchId ─────────────────────────────────────────────────
  app.get(
    "/patches/:patchId",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { patchId } = req.params as { patchId: string };
      const patch = getPatch(patchId);
      if (!patch) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Patch ${patchId} not found` },
        });
      }
      return reply.send({ data: patch });
    },
  );

  // ── GET /patches/:patchId/validate ────────────────────────────────────────
  app.get(
    "/patches/:patchId/validate",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (req, reply) => {
      const { patchId } = req.params as { patchId: string };
      const result = validatePatch(patchId);
      if (!result) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Patch ${patchId} not found` },
        });
      }
      return reply.send({ data: result });
    },
  );

  // ── POST /patches/:patchId/approve ────────────────────────────────────────
  app.post(
    "/patches/:patchId/approve",
    { onRequest: [requirePermission("admin.developer.patch")] },
    async (req, reply) => {
      const { patchId } = req.params as { patchId: string };
      const approvedBy = (req.user as { sub?: string })?.sub ?? "admin";
      const updated = approvePatchById(patchId, approvedBy);
      if (!updated) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Patch ${patchId} not found` },
        });
      }
      return reply.send({ data: updated });
    },
  );

  // ── POST /patches/:patchId/reject ─────────────────────────────────────────
  app.post(
    "/patches/:patchId/reject",
    { onRequest: [requirePermission("admin.developer.patch")] },
    async (req, reply) => {
      const { patchId } = req.params as { patchId: string };
      const body = z.object({ reason: z.string().min(1) }).parse(req.body ?? {});
      const rejectedBy = (req.user as { sub?: string })?.sub ?? "admin";
      const updated = rejectPatchById(patchId, rejectedBy, body.reason);
      if (!updated) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Patch ${patchId} not found` },
        });
      }
      return reply.send({ data: updated });
    },
  );

  // ── GET /patches/history ──────────────────────────────────────────────────
  app.get(
    "/patches/history",
    { onRequest: [requirePermission("admin.developer.view")] },
    async (_req, reply) => {
      return reply.send({ data: getPatchAuditHistory() });
    },
  );

  // ── POST /scan ────────────────────────────────────────────────────────────
  // Starts a background scan. Returns immediately with the scan ID.
  // Client polls GET /scan/:scanId for progress, then GET /issues for results.
  app.post(
    "/scan",
    { onRequest: [requirePermission("admin.developer.scan")] },
    async (req, reply) => {
      const body = z
        .object({ type: z.enum(SCAN_TYPES).default("full") })
        .parse(req.body ?? {});

      const progress = await triggerScan(
        body.type as ScanType,
        (req.user as { sub?: string })?.sub ?? "admin",
      );

      return reply.status(202).send({
        data: {
          scanId:   progress.scanId,
          status:   progress.status,
          startedAt: progress.startedAt,
          message:  "Scan started. Poll GET /scan/:scanId for progress.",
        },
      });
    },
  );
}
