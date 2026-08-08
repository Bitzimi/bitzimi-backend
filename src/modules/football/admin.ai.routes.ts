/**
 * Admin AI Routes — Phase 17.1
 *
 * REST API for AI engine management: config, status, queue, analysis, versions, learning.
 * All routes require admin.ai.view or admin.ai.manage permissions.
 *
 * Prefix: /api/v1/admin/ai
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../admin/admin.middleware";
import {
  getEngineConfig,
  updateEngineConfig,
  resetEngineConfig,
  getEngineStatus,
  getModelVersions,
  createModelVersion,
  activateModelVersion,
} from "./ai-engine.service";
import {
  getAnalysisList,
  getAnalysisForMatch,
  triggerMatchAnalysis,
  retryQueueItem,
  getQueue,
  queueMatchForAnalysis,
  removeFromQueue,
  getQueueStats,
} from "./ai-analysis.service";
import {
  getLearningMetrics,
  computeLearningMetrics,
} from "./ai-learning.service";
import {
  generatePredictionFromAnalysis,
  listAiPredictions,
  getAiPrediction,
  patchAiPrediction,
  approveAiPrediction,
  publishAiPrediction,
  rejectAiPrediction,
  getMatchAiPrediction,
} from "./ai-prediction-generation.service";
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  rotateApiKey,
  checkProviderHealth,
  getProviderLogs,
  getLeagueMappings,
  upsertLeagueMapping,
  deleteLeagueMapping,
  discoverLeagues,
} from "./provider/provider.service";
import { PROVIDER_TYPES } from "./provider/provider.registry";
import { getPublishConfig, updatePublishConfig } from "./ai-publish.service";
import { getDiagnostics }    from "./ai-diagnostics.service";
import { getMonitoringLogs } from "./ai-monitoring.service";
import {
  getLeagueWeights,
  listLeagueWeights,
  optimizeFeatureWeights,
  getDriftAlerts,
  resolveDriftAlert,
  markDriftAlertRead,
} from "./ai-learning.service";

export async function adminAiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authenticate);

  // Allow empty bodies on routes that accept optional JSON
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body || (body as string).trim() === "") { done(null, {}); return; }
    try { done(null, JSON.parse(body as string)); }
    catch (err) { done(err as Error, undefined); }
  });

  // ── Engine Status ─────────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/status — Engine health + live queue depth */
  app.get("/status", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    const [status, config] = await Promise.all([getEngineStatus(), getEngineConfig()]);
    return reply.send({ data: { status, config: { isEnabled: config.isEnabled, modelVersion: config.modelVersion } } });
  });

  // ── Engine Config ─────────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/config */
  app.get("/config", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: await getEngineConfig() });
  });

  const updateConfigSchema = z.object({
    isEnabled:         z.boolean().optional(),
    modelVersion:      z.string().min(1).optional(),
    featureWeights:    z.record(z.number().min(0).max(1)).optional(),
    minConfidence:     z.number().int().min(0).max(100).optional(),
    highConfidence:    z.number().int().min(0).max(100).optional(),
    maxQueueSize:      z.number().int().min(1).max(1000).optional(),
    analysisTimeoutMs: z.number().int().min(1000).optional(),
  });

  /** PATCH /api/v1/admin/ai/config */
  app.patch("/config", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = updateConfigSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    const cfg = await updateEngineConfig({ ...body.data, updatedBy: req.user.sub });
    return reply.send({ data: cfg });
  });

  /** POST /api/v1/admin/ai/config/reset */
  app.post("/config/reset", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const cfg = await resetEngineConfig(req.user.sub);
    return reply.send({ data: cfg });
  });

  // ── Model Versions ────────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/versions */
  app.get("/versions", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: await getModelVersions() });
  });

  const createVersionSchema = z.object({
    version:   z.string().min(1).regex(/^\d+\.\d+\.\d+$/, "Version must be semver e.g. 1.2.0"),
    changelog: z.string().optional(),
  });

  /** POST /api/v1/admin/ai/versions */
  app.post("/versions", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = createVersionSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    const version = await createModelVersion({ ...body.data, createdBy: req.user.sub });
    return reply.status(201).send({ data: version });
  });

  /** POST /api/v1/admin/ai/versions/:id/activate */
  app.post("/versions/:id/activate", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const version = await activateModelVersion(id);
      return reply.send({ data: version });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Model version not found" } });
    }
  });

  // ── Analysis ──────────────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/analyses */
  app.get("/analyses", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { cursor, limit, status, matchId } = req.query as Record<string, string>;
    const result = await getAnalysisList({
      cursor,
      limit:   limit   ? parseInt(limit) : undefined,
      status,
      matchId,
    });
    return reply.send({ data: result });
  });

  /** GET /api/v1/admin/ai/analyses/:matchId */
  app.get("/analyses/:matchId", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const analysis = await getAnalysisForMatch(matchId);
    if (!analysis) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "No analysis found for this match" } });
    return reply.send({ data: analysis });
  });

  /** POST /api/v1/admin/ai/analyses/:matchId/trigger
   *  Queues a match for AI analysis. Phase 17.2 will process the queue.
   */
  app.post("/analyses/:matchId/trigger", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    try {
      const analysis = await triggerMatchAnalysis(matchId, req.user.sub);
      return reply.status(202).send({ data: analysis });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "ENGINE_ERROR", message: e.message } });
    }
  });

  // ── Queue ─────────────────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/queue */
  app.get("/queue", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { cursor, limit, status } = req.query as Record<string, string>;
    const [queue, stats] = await Promise.all([
      getQueue({ cursor, limit: limit ? parseInt(limit) : undefined, status }),
      getQueueStats(),
    ]);
    return reply.send({ data: { ...queue, stats } });
  });

  const enqueueSchema = z.object({
    priority: z.number().int().min(1).max(10).optional().default(5),
  });

  /** POST /api/v1/admin/ai/queue/:matchId — Enqueue a match */
  app.post("/queue/:matchId", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const body = enqueueSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const item = await queueMatchForAnalysis(matchId, body.data.priority, req.user.sub);
      return reply.status(201).send({ data: item });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "QUEUE_ERROR", message: e.message } });
    }
  });

  /** DELETE /api/v1/admin/ai/queue/:id — Remove from queue */
  app.delete("/queue/:id", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await removeFromQueue(id);
      return reply.send({ data: { success: true } });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "QUEUE_ERROR", message: e.message } });
    }
  });

  /** POST /api/v1/admin/ai/queue/:id/retry — Retry a failed queue item */
  app.post("/queue/:id/retry", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const item = await retryQueueItem(id);
      return reply.send({ data: item });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "QUEUE_ERROR", message: e.message } });
    }
  });

  // ── Learning Metrics ──────────────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/learning — All periods, or ?period=YYYY-MM for one */
  app.get("/learning", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { period } = req.query as Record<string, string>;
    const metrics = await getLearningMetrics(period);
    return reply.send({ data: metrics });
  });

  const computeSchema = z.object({
    period: z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM format").optional(),
  });

  /** POST /api/v1/admin/ai/learning/compute — Recompute metrics for a period */
  app.post("/learning/compute", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = computeSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    const metrics = await computeLearningMetrics(body.data.period);
    return reply.send({ data: metrics });
  });

  // ── AI Prediction Generation & Review — Phase 17.3 ───────────────────────────

  const editPredSchema = z.object({
    market:     z.string().min(1).optional(),
    prediction: z.string().min(1).optional(),
    confidence: z.number().int().min(1).max(100).optional(),
    riskLevel:  z.enum(["low", "medium", "high"]).optional(),
    isVip:      z.boolean().optional(),
    analysis:   z.string().optional(),
    reasoning:  z.string().optional(),
  }).default({});

  /** POST /api/v1/admin/ai/predictions/:matchId/generate
   *  Reads the completed AIMatchAnalysis and creates a FootballPrediction in "ai_review" status.
   */
  app.post("/predictions/:matchId/generate", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    try {
      const pred = await generatePredictionFromAnalysis(matchId, req.user.sub);
      return reply.status(201).send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "GENERATION_ERROR", message: e.message } });
    }
  });

  /** GET /api/v1/admin/ai/predictions — List AI-generated predictions (filter by status) */
  app.get("/predictions", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { cursor, limit, status } = req.query as Record<string, string>;
    const result = await listAiPredictions({
      cursor,
      limit:  limit ? parseInt(limit) : undefined,
      status,
    });
    return reply.send({ data: result });
  });

  /** GET /api/v1/admin/ai/predictions/match/:matchId — Check if a match has an AI prediction */
  app.get("/predictions/match/:matchId", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    const pred = await getMatchAiPrediction(matchId);
    return reply.send({ data: pred ?? null });
  });

  /** GET /api/v1/admin/ai/predictions/:id — Single AI prediction by ID */
  app.get("/predictions/:id", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const pred = await getAiPrediction(id);
      return reply.send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 404).send({ error: { code: "NOT_FOUND", message: e.message } });
    }
  });

  /** PATCH /api/v1/admin/ai/predictions/:id — Edit fields in place (no status change) */
  app.patch("/predictions/:id", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = editPredSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const pred = await patchAiPrediction(id, body.data);
      return reply.send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PREDICTION_ERROR", message: e.message } });
    }
  });

  /** POST /api/v1/admin/ai/predictions/:id/approve — Move ai_review → draft (save, don't publish) */
  app.post("/predictions/:id/approve", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = editPredSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const pred = await approveAiPrediction(id, body.data);
      return reply.send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PREDICTION_ERROR", message: e.message } });
    }
  });

  /** POST /api/v1/admin/ai/predictions/:id/publish — Move ai_review|draft → published */
  app.post("/predictions/:id/publish", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = editPredSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const pred = await publishAiPrediction(id, body.data);
      return reply.send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PREDICTION_ERROR", message: e.message } });
    }
  });

  /** POST /api/v1/admin/ai/predictions/:id/reject — Move ai_review|draft → rejected */
  app.post("/predictions/:id/reject", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const pred = await rejectAiPrediction(id);
      return reply.send({ data: pred });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PREDICTION_ERROR", message: e.message } });
    }
  });

  // ── Phase 18.1 — Provider Management ─────────────────────────────────────────

  /** Mask API key — never expose raw key in responses; only indicate presence. */
  function maskProvider<T extends { apiKey?: string | null }>(p: T): Omit<T, "apiKey"> & { hasApiKey: boolean } {
    const { apiKey, ...rest } = p;
    return { ...rest, hasApiKey: !!apiKey };
  }

  /** GET /api/v1/admin/ai/provider-types — Available provider type definitions */
  app.get("/provider-types", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: PROVIDER_TYPES });
  });

  /** GET /api/v1/admin/ai/providers — List all configured providers */
  app.get("/providers", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: (await listProviders()).map(maskProvider) });
  });

  const providerCreateSchema = z.object({
    name:       z.string().min(1),
    type:       z.string().min(1),
    baseUrl:    z.string().url().optional().or(z.literal("")),
    apiKey:     z.string().optional(),
    priority:   z.number().int().min(1).max(10).optional(),
    dailyQuota: z.number().int().min(0).optional(),
    rateLimit:  z.number().int().min(1).optional(),
  });

  /** POST /api/v1/admin/ai/providers — Create a new provider */
  app.post("/providers", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = providerCreateSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const provider = await createProvider({
        name:       body.data.name,
        type:       body.data.type,
        baseUrl:    body.data.baseUrl ?? "",
        apiKey:     body.data.apiKey,
        priority:   body.data.priority,
        dailyQuota: body.data.dailyQuota,
        rateLimit:  body.data.rateLimit,
      });
      return reply.status(201).send({ data: maskProvider(provider) });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PROVIDER_ERROR", message: e.message } });
    }
  });

  /** GET /api/v1/admin/ai/providers/:id — Single provider details */
  app.get("/providers/:id", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const provider = await getProvider(id);
      return reply.send({ data: maskProvider(provider) });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 404).send({ error: { code: "NOT_FOUND", message: e.message } });
    }
  });

  const providerUpdateSchema = z.object({
    name:       z.string().min(1).optional(),
    baseUrl:    z.string().optional(),
    priority:   z.number().int().min(1).max(10).optional(),
    isEnabled:  z.boolean().optional(),
    isDefault:  z.boolean().optional(),
    dailyQuota: z.number().int().min(0).optional(),
    rateLimit:  z.number().int().min(1).optional(),
    config:     z.string().optional(),
  }).default({});

  /** PATCH /api/v1/admin/ai/providers/:id — Update provider settings */
  app.patch("/providers/:id", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = providerUpdateSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    try {
      const provider = await updateProvider(id, body.data);
      return reply.send({ data: maskProvider(provider) });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "PROVIDER_ERROR", message: e.message } });
    }
  });

  /** DELETE /api/v1/admin/ai/providers/:id — Remove a provider */
  app.delete("/providers/:id", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await deleteProvider(id);
      return reply.send({ data: { success: true } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Provider not found" } });
    }
  });

  /** POST /api/v1/admin/ai/providers/:id/test — Run health check */
  app.post("/providers/:id/test", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await checkProviderHealth(id);
      const p = await getProvider(id);
      return reply.send({ data: { healthStatus: p.healthStatus, avgLatencyMs: p.avgLatencyMs, lastError: p.lastError } });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "HEALTH_ERROR", message: e.message } });
    }
  });

  /** POST /api/v1/admin/ai/providers/:id/rotate-key — Rotate the API key */
  app.post("/providers/:id/rotate-key", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ apiKey: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "apiKey is required" } });
    try {
      const provider = await rotateApiKey(id, body.data.apiKey);
      return reply.send({ data: { id: provider.id, healthStatus: "unknown" } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Provider not found" } });
    }
  });

  /** GET /api/v1/admin/ai/providers/:id/logs — Sync log history */
  app.get("/providers/:id/logs", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { limit } = req.query as Record<string, string>;
    return reply.send({ data: await getProviderLogs(id, limit ? parseInt(limit) : 50) });
  });

  /** GET /api/v1/admin/ai/providers/:id/mappings — League mappings for this provider */
  app.get("/providers/:id/mappings", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await getLeagueMappings(id) });
  });

  /** GET /api/v1/admin/ai/providers/:id/discover — Fetch leagues from the live API */
  app.get("/providers/:id/discover", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const leagues = await discoverLeagues(id);
      return reply.send({ data: leagues });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return reply.status(e.statusCode ?? 500).send({ error: { code: "DISCOVER_ERROR", message: e.message } });
    }
  });

  const mappingSchema = z.object({
    leagueId:     z.string().min(1),
    externalId:   z.string().min(1),
    externalName: z.string().min(1),
  });

  /** POST /api/v1/admin/ai/providers/:id/mappings — Add/update a league mapping */
  app.post("/providers/:id/mappings", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = mappingSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    const mapping = await upsertLeagueMapping({ providerId: id, ...body.data });
    return reply.status(201).send({ data: mapping });
  });

  /** DELETE /api/v1/admin/ai/providers/mappings/:mappingId — Remove a league mapping */
  app.delete("/providers/mappings/:mappingId", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { mappingId } = req.params as { mappingId: string };
    try {
      await deleteLeagueMapping(mappingId);
      return reply.send({ data: { success: true } });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Mapping not found" } });
    }
  });

  // ── Phase 18.1 — Publishing Config ───────────────────────────────────────────

  /** GET /api/v1/admin/ai/publish-config */
  app.get("/publish-config", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: await getPublishConfig() });
  });

  const publishConfigSchema = z.object({
    autoPublish:            z.boolean().optional(),
    autoPublishMode:        z.enum(["manual", "immediate", "hours_before"]).optional(),
    hoursBeforeKickoff:     z.number().int().min(1).max(72).optional(),
    minConfidenceToPublish: z.number().int().min(1).max(100).optional(),
    publishVipOnly:         z.boolean().optional(),
    requireAdminApproval:   z.boolean().optional(),
    autoQueueNewMatches:    z.boolean().optional(),
    queueHoursAhead:        z.number().int().min(1).max(168).optional(),
  }).default({});

  /** PATCH /api/v1/admin/ai/publish-config */
  app.patch("/publish-config", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = publishConfigSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    const cfg = await updatePublishConfig(body.data, req.user.sub);
    return reply.send({ data: cfg });
  });

  // ── Phase 18.1 — Diagnostics ──────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/diagnostics — Full system health snapshot */
  app.get("/diagnostics", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: await getDiagnostics() });
  });

  // ── Phase 18.1 — Monitoring Logs ─────────────────────────────────────────────

  /** GET /api/v1/admin/ai/monitoring — Paginated component event log */
  app.get("/monitoring", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { component, cursor, limit } = req.query as Record<string, string>;
    const result = await getMonitoringLogs({ component, cursor, limit: limit ? parseInt(limit) : 50 });
    return reply.send({ data: result });
  });

  // ── Phase 18.1 — Enhanced Learning ───────────────────────────────────────────

  /** GET /api/v1/admin/ai/learning/weights — All per-league/market weight rows */
  app.get("/learning/weights", { onRequest: [requirePermission("admin.ai.view")] }, async (_req, reply) => {
    return reply.send({ data: await listLeagueWeights() });
  });

  /** GET /api/v1/admin/ai/learning/weights/:scope — Weights for scope (global|leagueId) */
  app.get("/learning/weights/:scope", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const leagueId = scope === "global" ? undefined : scope;
    return reply.send({ data: await getLeagueWeights(leagueId) });
  });

  /** POST /api/v1/admin/ai/learning/optimize — Trigger weight optimisation */
  app.post("/learning/optimize", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const body = z.object({ leagueId: z.string().optional() }).default({}).safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    await optimizeFeatureWeights(body.data.leagueId);
    return reply.send({ data: { success: true } });
  });

  // ── Phase 18.1 — Drift Alerts ─────────────────────────────────────────────────

  /** GET /api/v1/admin/ai/drift-alerts — Unresolved drift alerts */
  app.get("/drift-alerts", { onRequest: [requirePermission("admin.ai.view")] }, async (req, reply) => {
    const { resolved } = req.query as Record<string, string>;
    return reply.send({ data: await getDriftAlerts(resolved === "true") });
  });

  /** POST /api/v1/admin/ai/drift-alerts/:id/resolve */
  app.post("/drift-alerts/:id/resolve", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const alert = await resolveDriftAlert(id);
      return reply.send({ data: alert });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Alert not found" } });
    }
  });

  /** POST /api/v1/admin/ai/drift-alerts/:id/read */
  app.post("/drift-alerts/:id/read", { onRequest: [requirePermission("admin.ai.manage")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const alert = await markDriftAlertRead(id);
      return reply.send({ data: alert });
    } catch {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Alert not found" } });
    }
  });
}
