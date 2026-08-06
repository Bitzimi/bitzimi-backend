/**
 * AI Diagnostics Service — Phase 18.1
 *
 * Aggregates health information from every AI subsystem into a single
 * snapshot: engine, providers, queue, learning, drift, workers, scheduler.
 */

import { db } from "../../db";

export interface DiagnosticsSnapshot {
  timestamp:    string;
  overallHealth: "healthy" | "degraded" | "unhealthy";

  engine: {
    status:        string;
    health:        string;
    isEnabled:     boolean;
    lastRunAt:     string | null;
    lastError:     string | null;
    analysisCount: number;
    queueDepth:    number;
    modelVersion:  string;
  };

  providers: {
    total:     number;
    enabled:   number;
    healthy:   number;
    degraded:  number;
    unhealthy: number;
    unknown:   number;
    items: Array<{
      id:          string;
      name:        string;
      type:        string;
      isEnabled:   boolean;
      isDefault:   boolean;
      healthStatus: string;
      avgLatencyMs: number;
      lastSyncAt:  string | null;
      lastError:   string | null;
    }>;
  };

  queue: {
    total:      number;
    queued:     number;
    processing: number;
    completed:  number;
    failed:     number;
    skipped:    number;
  };

  learning: {
    latestPeriod:   string | null;
    latestAccuracy: number | null;
    computedAt:     string | null;
    totalPeriods:   number;
  };

  drift: {
    unresolvedAlerts: number;
    criticalAlerts:   number;
    highAlerts:       number;
  };

  publishing: {
    autoPublish:  boolean;
    mode:         string;
    pendingReview: number;
    pendingDraft:  number;
  };
}

export async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  const [
    engineStatus,
    engineConfig,
    providers,
    queueStats,
    latestMetrics,
    metricsCount,
    driftAlerts,
    publishConfig,
    pendingReview,
    pendingDraft,
  ] = await Promise.all([
    db.aIEngineStatus.findFirst().catch(() => null),
    db.aIEngineConfig.findFirst().catch(() => null),
    db.dataProvider.findMany({ orderBy: { priority: "asc" } }),
    db.aIPredictionQueue.groupBy({
      by:     ["status"],
      _count: { id: true },
    }),
    db.aILearningMetrics.findFirst({ orderBy: { period: "desc" } }),
    db.aILearningMetrics.count(),
    db.aIDriftAlert.findMany({ where: { isResolved: false } }),
    db.aIPublishConfig.findUnique({ where: { id: "singleton" } }),
    db.footballPrediction.count({ where: { status: "ai_review", aiGenerated: true } }),
    db.footballPrediction.count({ where: { status: "draft",     aiGenerated: true } }),
  ]);

  const queueMap = Object.fromEntries(
    (queueStats as Array<{ status: string; _count: { id: number } }>)
      .map(r => [r.status, r._count.id]),
  );

  const providerItems = providers.map(p => ({
    id:           p.id,
    name:         p.name,
    type:         p.type,
    isEnabled:    p.isEnabled,
    isDefault:    p.isDefault,
    healthStatus: p.healthStatus,
    avgLatencyMs: p.avgLatencyMs,
    lastSyncAt:   p.lastSyncAt?.toISOString() ?? null,
    lastError:    p.lastError ?? null,
  }));

  const enabledProviders  = providers.filter(p => p.isEnabled);
  const healthyCnt        = enabledProviders.filter(p => p.healthStatus === "healthy").length;
  const degradedCnt       = enabledProviders.filter(p => p.healthStatus === "degraded").length;
  const unhealthyCnt      = enabledProviders.filter(p => p.healthStatus === "unhealthy").length;
  const unknownCnt        = enabledProviders.filter(p => p.healthStatus === "unknown").length;

  const criticalAlerts    = driftAlerts.filter(a => a.severity === "critical").length;
  const highAlerts        = driftAlerts.filter(a => a.severity === "high").length;

  // Overall health: degrade if engine is unhealthy, providers degraded, or critical drift
  let overallHealth: DiagnosticsSnapshot["overallHealth"] = "healthy";
  if (
    engineStatus?.health === "unhealthy" ||
    unhealthyCnt > 0 ||
    criticalAlerts > 0
  ) {
    overallHealth = "unhealthy";
  } else if (
    engineStatus?.health === "degraded" ||
    degradedCnt > 0 ||
    highAlerts > 0 ||
    (driftAlerts.length > 0)
  ) {
    overallHealth = "degraded";
  }

  return {
    timestamp:    new Date().toISOString(),
    overallHealth,

    engine: {
      status:        engineStatus?.status        ?? "unknown",
      health:        engineStatus?.health        ?? "unknown",
      isEnabled:     engineConfig?.isEnabled     ?? false,
      lastRunAt:     engineStatus?.lastRunAt?.toISOString()    ?? null,
      lastError:     engineStatus?.lastError     ?? null,
      analysisCount: engineStatus?.analysisCount ?? 0,
      queueDepth:    engineStatus?.queueDepth    ?? 0,
      modelVersion:  engineConfig?.modelVersion  ?? "1.0.0",
    },

    providers: {
      total:     providers.length,
      enabled:   enabledProviders.length,
      healthy:   healthyCnt,
      degraded:  degradedCnt,
      unhealthy: unhealthyCnt,
      unknown:   unknownCnt,
      items:     providerItems,
    },

    queue: {
      total:      Object.values(queueMap).reduce((a, b) => a + b, 0),
      queued:     queueMap["queued"]     ?? 0,
      processing: queueMap["processing"] ?? 0,
      completed:  queueMap["completed"]  ?? 0,
      failed:     queueMap["failed"]     ?? 0,
      skipped:    queueMap["skipped"]    ?? 0,
    },

    learning: {
      latestPeriod:   latestMetrics?.period      ?? null,
      latestAccuracy: latestMetrics?.accuracy     ?? null,
      computedAt:     latestMetrics?.computedAt?.toISOString() ?? null,
      totalPeriods:   metricsCount,
    },

    drift: {
      unresolvedAlerts: driftAlerts.length,
      criticalAlerts,
      highAlerts,
    },

    publishing: {
      autoPublish:   publishConfig?.autoPublish  ?? false,
      mode:          publishConfig?.autoPublishMode ?? "manual",
      pendingReview,
      pendingDraft,
    },
  };
}
