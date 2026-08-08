/**
 * Auto-Publish Worker — Phase 18.1
 *
 * Evaluates AI-generated predictions against the AIPublishConfig rules and
 * publishes eligible ones automatically.
 *
 * Also runs drift detection and feature-weight optimisation on a longer cycle.
 *
 * Runs every minute. Skips everything if autoPublish is disabled.
 */

import { runAutoPublish }        from "../modules/football/ai-publish.service";
import { detectDrift, optimizeFeatureWeights } from "../modules/football/ai-learning.service";
import { logMonitoringEvent }    from "../modules/football/ai-monitoring.service";

const PUBLISH_INTERVAL_MS = 60_000;       // 1 minute
const DRIFT_INTERVAL_MS   = 60 * 60_000;  // 1 hour
const WEIGHT_INTERVAL_MS  = 6  * 60 * 60_000; // 6 hours

let driftLastRun  = 0;
let weightLastRun = 0;

export function startAutoPublishWorker(): void {
  const run = async () => {
    const now   = Date.now();
    const start = now;

    // ── Auto-publish ────────────────────────────────────────────────────────
    try {
      const published = await runAutoPublish();
      if (published > 0) {
        await logMonitoringEvent("publish", "completed", { published }, Date.now() - start);
        console.log(`[AutoPublish] Published ${published} prediction(s)`);
      }
    } catch (e: unknown) {
      console.error("[AutoPublish] Error:", (e as Error).message);
      await logMonitoringEvent("publish", "failed", { error: (e as Error).message });
    }

    // ── Drift detection (every hour) ───────────────────────────────────────
    if (now - driftLastRun >= DRIFT_INTERVAL_MS) {
      driftLastRun = now;
      try {
        const alerts = await detectDrift();
        if (alerts > 0) {
          await logMonitoringEvent("drift", "completed", { alertsCreated: alerts });
          console.log(`[Drift] Created ${alerts} drift alert(s)`);
        }
      } catch (e: unknown) {
        console.error("[Drift] Error:", (e as Error).message);
      }
    }

    // ── Feature weight optimisation (every 6 hours) ────────────────────────
    if (now - weightLastRun >= WEIGHT_INTERVAL_MS) {
      weightLastRun = now;
      try {
        await optimizeFeatureWeights(); // global
        await logMonitoringEvent("learning", "completed", { scope: "global_weights" });
      } catch (e: unknown) {
        console.error("[WeightOptimise] Error:", (e as Error).message);
      }
    }
  };

  // Stagger start so it doesn't fire alongside sync worker startup
  setTimeout(() => {
    run();
    const timer = setInterval(run, PUBLISH_INTERVAL_MS);
    timer.unref();
  }, 30_000);

  console.log("[AutoPublish] Worker started — polling every 60s");
}
