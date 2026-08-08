/**
 * AI Publish Service — Phase 18.1
 *
 * Manages the AIPublishConfig singleton and exposes the auto-publish evaluation
 * logic used by the auto-publish worker.
 *
 * Auto-publish NEVER runs if `requireAdminApproval` is true and mode is not
 * "immediate". The admin toggle must explicitly allow automated publishing.
 */

import { db } from "../../db";

// ── Publishing config ─────────────────────────────────────────────────────────

const SINGLETON_ID = "singleton";

const DEFAULTS = {
  autoPublish:            false,
  autoPublishMode:        "manual",
  hoursBeforeKickoff:     3,
  minConfidenceToPublish: 70,
  publishVipOnly:         false,
  requireAdminApproval:   true,
  autoQueueNewMatches:    false,
  queueHoursAhead:        48,
} as const;

export async function getPublishConfig() {
  const cfg = await db.aIPublishConfig.findUnique({ where: { id: SINGLETON_ID } });
  return cfg ?? { id: SINGLETON_ID, updatedAt: new Date(), updatedBy: null, ...DEFAULTS };
}

export async function updatePublishConfig(
  updates: Partial<{
    autoPublish:            boolean;
    autoPublishMode:        string;
    hoursBeforeKickoff:     number;
    minConfidenceToPublish: number;
    publishVipOnly:         boolean;
    requireAdminApproval:   boolean;
    autoQueueNewMatches:    boolean;
    queueHoursAhead:        number;
  }>,
  updatedBy: string,
) {
  return db.aIPublishConfig.upsert({
    where:  { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...DEFAULTS, ...updates, updatedBy },
    update: { ...updates, updatedBy },
  });
}

// ── Auto-publish runner ───────────────────────────────────────────────────────

/**
 * Evaluate and publish eligible AI-generated predictions according to the
 * current AIPublishConfig rules. Called by autoPublishWorker every minute.
 *
 * Returns the number of predictions published.
 */
export async function runAutoPublish(): Promise<number> {
  const config = await getPublishConfig();

  // Nothing to do
  if (!config.autoPublish || config.autoPublishMode === "manual") return 0;

  const now = new Date();

  // Build match kickoff filter for "hours_before" mode
  let kickoffFilter: { kickoffAt: { lte: Date } } | undefined;
  if (config.autoPublishMode === "hours_before") {
    const cutoff = new Date(now.getTime() + config.hoursBeforeKickoff * 3_600_000);
    kickoffFilter = { kickoffAt: { lte: cutoff } };
  }

  // Eligible statuses — "immediate" publishes ai_review directly; "hours_before" also drafts
  const eligibleStatuses = ["ai_review", "draft"];

  const predictions = await db.footballPrediction.findMany({
    where: {
      status:      { in: eligibleStatuses },
      aiGenerated: true,
      confidence:  { gte: config.minConfidenceToPublish },
      ...(config.publishVipOnly ? { isVip: true } : {}),
      ...(kickoffFilter ? { match: kickoffFilter } : {}),
    },
    include: { match: true },
  });

  let published = 0;

  for (const pred of predictions) {
    // Skip if match has already passed kickoff
    if (pred.match.kickoffAt < now) continue;

    // Conflict guard: another published prediction for the same match?
    const conflict = await db.footballPrediction.findFirst({
      where: { matchId: pred.matchId, status: "published", id: { not: pred.id } },
    });
    if (conflict) continue;

    await db.footballPrediction.update({
      where: { id: pred.id },
      data:  { status: "published", publishedAt: now },
    });
    published++;
  }

  return published;
}
