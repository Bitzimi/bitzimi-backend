/**
 * Provider service — CRUD, health monitoring, league mappings, adapter selection.
 * All business logic lives here; routes delegate to this service.
 */

import { db } from "../../../db";
import { createProviderAdapter, PROVIDER_TYPES } from "./provider.registry";
import { ProviderAdapter } from "./provider.interface";

// ── Adapter selection ─────────────────────────────────────────────────────────

/** Returns the highest-priority enabled adapter that has an API key. */
export async function getActiveAdapter(): Promise<ProviderAdapter | null> {
  const providers = await db.dataProvider.findMany({
    where: { isEnabled: true },
    orderBy: { priority: "asc" },
  });
  for (const p of providers) {
    if (!p.apiKey) continue;
    try {
      return createProviderAdapter(p.type, p.apiKey, p.baseUrl);
    } catch {
      continue;
    }
  }
  return null;
}

/** Returns an adapter for a specific provider ID. Throws if no key or unknown type. */
export async function getAdapterForProvider(providerId: string): Promise<ProviderAdapter> {
  const p = await db.dataProvider.findUniqueOrThrow({ where: { id: providerId } });
  if (!p.apiKey) throw Object.assign(new Error("No API key configured for this provider"), { statusCode: 422 });
  return createProviderAdapter(p.type, p.apiKey, p.baseUrl);
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkProviderHealth(providerId: string): Promise<void> {
  const adapter = await getAdapterForProvider(providerId);
  const health  = await adapter.checkHealth();
  await db.dataProvider.update({
    where: { id: providerId },
    data: {
      healthStatus:  health.healthy ? "healthy" : "unhealthy",
      avgLatencyMs:  health.latencyMs,
      lastCheckedAt: new Date(),
      lastError:     health.error ?? null,
    },
  });
}

/** Run health checks on all enabled providers (called periodically). */
export async function checkAllProvidersHealth(): Promise<void> {
  const providers = await db.dataProvider.findMany({ where: { isEnabled: true } });
  await Promise.allSettled(providers.map(p => checkProviderHealth(p.id)));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listProviders() {
  return db.dataProvider.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] });
}

export async function getProvider(id: string) {
  const p = await db.dataProvider.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Provider not found"), { statusCode: 404 });
  return p;
}

export async function createProvider(data: {
  name:        string;
  type:        string;
  baseUrl:     string;
  apiKey?:     string;
  priority?:   number;
  dailyQuota?: number;
  rateLimit?:  number;
}) {
  const meta = PROVIDER_TYPES.find(t => t.type === data.type);
  return db.dataProvider.create({
    data: {
      name:        data.name,
      type:        data.type,
      baseUrl:     data.baseUrl || meta?.defaultBaseUrl || "",
      apiKey:      data.apiKey ?? null,
      priority:    data.priority ?? 5,
      dailyQuota:  data.dailyQuota ?? 0,
      rateLimit:   data.rateLimit ?? meta?.rateLimit ?? 60,
      healthStatus: "unknown",
    },
  });
}

export async function updateProvider(
  id:   string,
  data: Partial<{
    name:        string;
    type:        string;
    baseUrl:     string;
    priority:    number;
    isEnabled:   boolean;
    isDefault:   boolean;
    dailyQuota:  number;
    rateLimit:   number;
    config:      string;
  }>,
) {
  if (data.isDefault) {
    await db.dataProvider.updateMany({
      where: { isDefault: true, id: { not: id } },
      data:  { isDefault: false },
    });
  }
  return db.dataProvider.update({ where: { id }, data });
}

export async function deleteProvider(id: string) {
  return db.dataProvider.delete({ where: { id } });
}

export async function rotateApiKey(id: string, newKey: string) {
  return db.dataProvider.update({
    where: { id },
    data:  { apiKey: newKey, healthStatus: "unknown", lastCheckedAt: null, lastError: null },
  });
}

// ── Sync logs ─────────────────────────────────────────────────────────────────

export async function getProviderLogs(providerId: string, limit = 50) {
  return db.providerSyncLog.findMany({
    where:   { providerId },
    orderBy: { startedAt: "desc" },
    take:    limit,
  });
}

// ── League mappings ───────────────────────────────────────────────────────────

export async function getLeagueMappings(providerId: string) {
  return db.providerLeagueMapping.findMany({
    where:   { providerId },
    include: { league: true },
    orderBy: { externalName: "asc" },
  });
}

export async function upsertLeagueMapping(data: {
  providerId:   string;
  leagueId:     string;
  externalId:   string;
  externalName: string;
}) {
  return db.providerLeagueMapping.upsert({
    where:  { providerId_externalId: { providerId: data.providerId, externalId: data.externalId } },
    create: data,
    update: { externalName: data.externalName, leagueId: data.leagueId, isActive: true },
  });
}

export async function deleteLeagueMapping(mappingId: string) {
  return db.providerLeagueMapping.delete({ where: { id: mappingId } });
}

/** Fetch all leagues from provider and upsert as mapping candidates. Returns the list. */
export async function discoverLeagues(providerId: string) {
  const adapter = await getAdapterForProvider(providerId);
  const leagues = await adapter.fetchLeagues();
  return leagues;
}
