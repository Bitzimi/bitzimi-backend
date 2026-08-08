/**
 * Football Sync Worker — Phase 18.1
 *
 * Polls active data providers to synchronise leagues, fixtures, live scores
 * and final results. Automatically queues newly discovered matches for AI
 * analysis when `autoQueueNewMatches` is enabled.
 *
 * Runs every 5 minutes. Gracefully skips if no provider is configured.
 */

import { db }                  from "../db";
import { getActiveAdapter }    from "../modules/football/provider/provider.service";
import { queueMatchForAnalysis } from "../modules/football/ai-analysis.service";
import { logMonitoringEvent }  from "../modules/football/ai-monitoring.service";

const POLL_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const INITIAL_DELAY_MS = 15_000;          // give the server time to fully start

export function startFootballSyncWorker(): void {
  const run = async () => {
    const start = Date.now();
    try {
      await logMonitoringEvent("sync", "started");
      const result = await syncAll();
      await logMonitoringEvent("sync", "completed", result, Date.now() - start);
    } catch (e: unknown) {
      console.error("[SyncWorker] Error:", (e as Error).message);
      await logMonitoringEvent("sync", "failed", { error: (e as Error).message }, Date.now() - start);
    }
  };

  setTimeout(run, INITIAL_DELAY_MS);
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref();
  console.log("[SyncWorker] Started — polling every 5 minutes");
}

// ── Main sync orchestration ───────────────────────────────────────────────────

async function syncAll(): Promise<Record<string, number>> {
  const publishConfig = await db.aIPublishConfig.findUnique({ where: { id: "singleton" } });
  const autoQueue     = publishConfig?.autoQueueNewMatches ?? false;
  const hoursAhead    = publishConfig?.queueHoursAhead ?? 48;

  // Need at least one active provider with a key
  const adapter = await getActiveAdapter();
  if (!adapter) return { skipped: 1, reason: "no_provider" as unknown as number };

  // Get all active league mappings across all providers
  const mappings = await db.providerLeagueMapping.findMany({
    where:   { isActive: true },
    include: { league: true },
  });
  if (mappings.length === 0) return { skipped: 1, reason: "no_mappings" as unknown as number };

  const from = new Date();
  const to   = new Date(from.getTime() + hoursAhead * 3_600_000);

  let newMatches     = 0;
  let updatedMatches = 0;
  let queuedMatches  = 0;
  let errors         = 0;

  for (const mapping of mappings) {
    try {
      // Record start of this sync run in provider table
      await db.dataProvider.update({
        where: { id: mapping.providerId },
        data:  { lastSyncAt: new Date() },
      });

      const fixtures = await adapter.fetchFixtures(mapping.externalId, from, to);

      for (const fix of fixtures) {
        const existing = await db.footballMatch.findFirst({
          where: { externalId: fix.externalId },
        });

        if (existing) {
          // Update only if something changed
          const changed =
            existing.status    !== fix.status ||
            existing.homeScore !== (fix.homeScore ?? null) ||
            existing.awayScore !== (fix.awayScore ?? null);

          if (changed) {
            await db.footballMatch.update({
              where: { id: existing.id },
              data: {
                status:    fix.status,
                homeScore: fix.homeScore ?? null,
                awayScore: fix.awayScore ?? null,
              },
            });
            updatedMatches++;
          }
        } else {
          // Create new match from provider data
          const newMatch = await db.footballMatch.create({
            data: {
              leagueId:   mapping.leagueId,
              homeTeam:   fix.homeTeam,
              awayTeam:   fix.awayTeam,
              kickoffAt:  fix.kickoffAt,
              status:     fix.status,
              homeScore:  fix.homeScore ?? null,
              awayScore:  fix.awayScore ?? null,
              externalId: fix.externalId,
              syncedFrom: mapping.providerId,
              createdBy:  "sync-worker",
            },
          });
          newMatches++;

          // Automatically queue for AI analysis if configured
          if (autoQueue && fix.status === "upcoming") {
            await queueMatchForAnalysis(newMatch.id, 5, "sync-worker").catch(() => null);
            queuedMatches++;
          }
        }
      }

      // Also sync live scores for any ongoing fixtures
      const live = await adapter.fetchLiveFixtures().catch(() => []);
      for (const fix of live) {
        const existing = await db.footballMatch.findFirst({ where: { externalId: fix.externalId } });
        if (!existing) continue;
        await db.footballMatch.update({
          where: { id: existing.id },
          data:  { status: "live", homeScore: fix.homeScore ?? null, awayScore: fix.awayScore ?? null },
        });
        updatedMatches++;
      }

    } catch (e: unknown) {
      console.error(`[SyncWorker] League ${mapping.externalName}:`, (e as Error).message);
      errors++;
    }
  }

  return { newMatches, updatedMatches, queuedMatches, errors };
}
