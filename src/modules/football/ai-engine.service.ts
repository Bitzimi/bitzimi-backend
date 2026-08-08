/**
 * AI Engine Service — Phase 17.1
 *
 * Manages the singleton AIEngineConfig and AIEngineStatus rows.
 * All mutation is admin-only; reads are used by the analysis pipeline.
 */

import { db } from "../../db";

// ── Default feature weights ───────────────────────────────────────────────────

const DEFAULT_FEATURE_WEIGHTS = {
  homeForm:        0.30,
  awayForm:        0.25,
  h2h:             0.20,
  leagueStrength:  0.15,
  venueAdvantage:  0.10,
};

// ── Config ────────────────────────────────────────────────────────────────────

export async function getEngineConfig() {
  let cfg = await db.aIEngineConfig.findFirst();
  if (!cfg) {
    cfg = await db.aIEngineConfig.create({
      data: { featureWeights: JSON.stringify(DEFAULT_FEATURE_WEIGHTS) },
    });
  }
  return {
    ...cfg,
    featureWeights: JSON.parse(cfg.featureWeights) as Record<string, number>,
  };
}

export interface UpdateEngineConfigInput {
  isEnabled?:         boolean;
  modelVersion?:      string;
  featureWeights?:    Record<string, number>;
  minConfidence?:     number;
  highConfidence?:    number;
  maxQueueSize?:      number;
  analysisTimeoutMs?: number;
  updatedBy?:         string;
}

export async function updateEngineConfig(data: UpdateEngineConfigInput) {
  const cfg = await db.aIEngineConfig.findFirst();
  const payload = {
    ...(data.isEnabled !== undefined         && { isEnabled: data.isEnabled }),
    ...(data.modelVersion                    && { modelVersion: data.modelVersion }),
    ...(data.featureWeights                  && { featureWeights: JSON.stringify(data.featureWeights) }),
    ...(data.minConfidence !== undefined     && { minConfidence: data.minConfidence }),
    ...(data.highConfidence !== undefined    && { highConfidence: data.highConfidence }),
    ...(data.maxQueueSize !== undefined      && { maxQueueSize: data.maxQueueSize }),
    ...(data.analysisTimeoutMs !== undefined && { analysisTimeoutMs: data.analysisTimeoutMs }),
    ...(data.updatedBy                       && { updatedBy: data.updatedBy }),
  };

  if (cfg) {
    const updated = await db.aIEngineConfig.update({ where: { id: cfg.id }, data: payload });
    return { ...updated, featureWeights: JSON.parse(updated.featureWeights) as Record<string, number> };
  }
  const created = await db.aIEngineConfig.create({
    data: { featureWeights: JSON.stringify(DEFAULT_FEATURE_WEIGHTS), ...payload },
  });
  return { ...created, featureWeights: JSON.parse(created.featureWeights) as Record<string, number> };
}

export async function resetEngineConfig(updatedBy: string) {
  const cfg = await db.aIEngineConfig.findFirst();
  const defaults = {
    isEnabled:         false,
    modelVersion:      "1.0.0",
    featureWeights:    JSON.stringify(DEFAULT_FEATURE_WEIGHTS),
    minConfidence:     60,
    highConfidence:    80,
    maxQueueSize:      100,
    analysisTimeoutMs: 30000,
    updatedBy,
  };
  if (cfg) {
    const updated = await db.aIEngineConfig.update({ where: { id: cfg.id }, data: defaults });
    return { ...updated, featureWeights: DEFAULT_FEATURE_WEIGHTS };
  }
  const created = await db.aIEngineConfig.create({ data: defaults });
  return { ...created, featureWeights: DEFAULT_FEATURE_WEIGHTS };
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getEngineStatus() {
  let status = await db.aIEngineStatus.findFirst();
  if (!status) {
    status = await db.aIEngineStatus.create({ data: {} });
  }
  // Attach live queue depth
  const queueDepth = await db.aIPredictionQueue.count({ where: { status: { in: ["queued", "processing"] } } });
  return { ...status, queueDepth };
}

export async function updateEngineStatus(patch: {
  status?:        string;
  health?:        string;
  lastRunAt?:     Date;
  lastErrorAt?:   Date;
  lastError?:     string | null;
  analysisCount?: number;
  version?:       string;
}) {
  const existing = await db.aIEngineStatus.findFirst();
  if (existing) {
    return db.aIEngineStatus.update({ where: { id: existing.id }, data: patch });
  }
  return db.aIEngineStatus.create({ data: patch });
}

// ── Model versions ────────────────────────────────────────────────────────────

export async function getModelVersions() {
  return db.aIModelVersion.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createModelVersion(data: {
  version:   string;
  changelog?: string;
  createdBy?: string;
}) {
  return db.aIModelVersion.create({ data });
}

export async function activateModelVersion(id: string) {
  await db.aIModelVersion.updateMany({ data: { isActive: false } });
  return db.aIModelVersion.update({
    where: { id },
    data:  { isActive: true, deployedAt: new Date() },
  });
}
