/**
 * AI Analysis Worker — Phase 17.2
 *
 * Background job that drains the AIPredictionQueue and runs the full analysis
 * pipeline on each queued match:
 *
 *   1. Feature extraction  — queries finished matches from BitZimi DB only
 *   2. Confidence scoring  — weighted probabilistic model, all markets
 *   3. Reasoning / analysis — template-based text, short + full markdown
 *   4. Persist to AIMatchAnalysis
 *   5. Update queue item status (completed / failed with retry)
 *   6. Update AIEngineStatus counters
 *
 * Pattern is identical to commissionJob.ts:
 *   - setInterval polling (30s)
 *   - Atomic updateMany claim guard — safe against concurrent processes
 *   - Up to MAX_ATTEMPTS retries; final failure marks item "failed"
 *   - Crash recovery on startup (reset "processing" → "queued")
 *   - timer.unref() for graceful shutdown
 */

import { db } from "../db";
import { extractMatchFeatures }          from "../modules/football/ai-feature-extraction.service";
import { computeConfidence }             from "../modules/football/ai-confidence.service";
import { buildReasoning, buildAnalysis } from "../modules/football/ai-reasoning.service";
import { getEngineConfig, updateEngineStatus } from "../modules/football/ai-engine.service";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const BATCH_SIZE       = 5;      // max matches per tick
const MAX_ATTEMPTS     = 3;

// ── Single-match pipeline ─────────────────────────────────────────────────────

async function runAnalysisPipeline(matchId: string): Promise<void> {
  const t0 = Date.now();

  // Load engine config on every call so hot config changes take effect immediately
  const cfg = await getEngineConfig();
  if (!cfg.isEnabled) {
    throw new Error("AI engine is disabled — enable it in Admin → AI → Config.");
  }

  const weights    = cfg.featureWeights as Record<string, number>;
  const thresholds = { minConfidence: cfg.minConfidence, highConfidence: cfg.highConfidence };

  // Mark analysis record as in progress before we start (idempotent upsert)
  await db.aIMatchAnalysis.upsert({
    where:  { matchId },
    create: { matchId, status: "analyzing", modelVersion: cfg.modelVersion },
    update: { status: "analyzing", error: null, modelVersion: cfg.modelVersion },
  });

  try {
    // Step 1 — Feature extraction (DB only, no external providers)
    const features = await extractMatchFeatures(matchId);

    // Step 2 — Confidence scoring
    const confidence = computeConfidence(features, weights, thresholds);

    // Step 3 — Reasoning text
    const reasoning = buildReasoning(features, confidence);
    const analysis  = buildAnalysis(features, confidence);

    const processingMs = Date.now() - t0;

    // Step 4 — Persist results
    await db.aIMatchAnalysis.upsert({
      where:  { matchId },
      create: {
        matchId,
        status:              "completed",
        modelVersion:        cfg.modelVersion,
        features:            JSON.stringify(features),
        confidenceData:      JSON.stringify(confidence),
        reasoning,
        analysis,
        suggestedMarket:     confidence.suggestedMarket,
        suggestedPrediction: confidence.suggestedPrediction,
        suggestedConfidence: confidence.suggestedConfidence,
        suggestedRiskLevel:  confidence.suggestedRiskLevel,
        suggestedIsVip:      confidence.suggestedIsVip,
        processingMs,
      },
      update: {
        status:              "completed",
        modelVersion:        cfg.modelVersion,
        features:            JSON.stringify(features),
        confidenceData:      JSON.stringify(confidence),
        reasoning,
        analysis,
        suggestedMarket:     confidence.suggestedMarket,
        suggestedPrediction: confidence.suggestedPrediction,
        suggestedConfidence: confidence.suggestedConfidence,
        suggestedRiskLevel:  confidence.suggestedRiskLevel,
        suggestedIsVip:      confidence.suggestedIsVip,
        processingMs,
        error:               null,
      },
    });

    console.log(`[AIWorker] Analysed match ${matchId} in ${processingMs}ms (quality: ${features.dataQuality})`);
  } catch (err) {
    // Persist the error to the analysis record so admin can see it
    await db.aIMatchAnalysis.upsert({
      where:  { matchId },
      create: { matchId, status: "failed", modelVersion: cfg.modelVersion, error: String(err) },
      update: { status: "failed", error: String(err) },
    });
    throw err; // rethrow so caller handles retry logic
  }
}

// ── Queue processor ───────────────────────────────────────────────────────────

async function processPendingQueue(): Promise<void> {
  const now = new Date();

  const items = await db.aIPredictionQueue.findMany({
    where: {
      status:      "queued",
      attempts:    { lt: MAX_ATTEMPTS },
      scheduledAt: { lte: now },
    },
    orderBy: [
      { priority:  "desc" }, // highest priority first
      { createdAt: "asc"  }, // oldest first within same priority
    ],
    take: BATCH_SIZE,
  });

  for (const item of items) {
    // Atomic claim — if another worker tick claimed it first, skip
    const claimed = await db.aIPredictionQueue.updateMany({
      where: { id: item.id, status: "queued" },
      data:  { status: "processing", startedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const newAttempts = item.attempts + 1;

    try {
      await runAnalysisPipeline(item.matchId);

      await db.aIPredictionQueue.update({
        where: { id: item.id },
        data:  {
          status:      "completed",
          attempts:    newAttempts,
          completedAt: new Date(),
          error:       null,
        },
      });

      // Increment the engine's analysis counter
      const statusRow = await db.aIEngineStatus.findFirst();
      await updateEngineStatus({
        lastRunAt:     new Date(),
        analysisCount: (statusRow?.analysisCount ?? 0) + 1,
        health:        "healthy",
        status:        "idle",
        lastError:     null,
      });
    } catch (err) {
      const isFinalAttempt = newAttempts >= MAX_ATTEMPTS;

      await db.aIPredictionQueue.update({
        where: { id: item.id },
        data:  {
          status:   isFinalAttempt ? "failed" : "queued",
          attempts: newAttempts,
          failedAt: isFinalAttempt ? new Date() : null,
          error:    String(err),
        },
      });

      await updateEngineStatus({
        lastErrorAt: new Date(),
        lastError:   String(err),
        health:      "degraded",
      }).catch(() => {});

      console.error(
        `[AIWorker] Match ${item.matchId} failed` +
        ` (attempt ${newAttempts}/${MAX_ATTEMPTS}):`,
        err
      );
    }
  }
}

// ── Startup recovery ──────────────────────────────────────────────────────────

async function recoverStuckItems(): Promise<void> {
  // Queue items stuck "processing" from a prior crash → reset to "queued"
  const recovered = await db.aIPredictionQueue.updateMany({
    where: { status: "processing" },
    data:  { status: "queued", startedAt: null },
  });

  // Analysis records stuck "analyzing" → mark failed (will be re-queued on retry)
  await db.aIMatchAnalysis.updateMany({
    where: { status: "analyzing" },
    data:  { status: "failed", error: "Server restarted during analysis — please retry." },
  });

  if (recovered.count > 0) {
    console.log(`[AIWorker] Recovered ${recovered.count} stuck queue item(s) on startup`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startAiAnalysisWorker(): NodeJS.Timeout {
  recoverStuckItems().catch(err =>
    console.error("[AIWorker] Startup recovery failed:", err)
  );

  const timer = setInterval(async () => {
    try {
      await processPendingQueue();
    } catch (err) {
      console.error("[AIWorker] Worker poll failed:", err);
    }
  }, POLL_INTERVAL_MS);

  timer.unref(); // do not block graceful shutdown

  console.log(`[AIWorker] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  return timer;
}
