/**
 * Commission Job Queue — DB-backed reliable processing.
 *
 * Replaces setImmediate fire-and-forget for all commission and referral bonus
 * events. Jobs are written to the database BEFORE the response returns, so
 * they survive server crashes and are retried automatically.
 *
 * Design:
 *   • Callers write a CommissionJob record (enqueue*).
 *   • startCommissionJobWorker() polls every 10 s, claims pending jobs,
 *     executes them, and marks them completed or failed.
 *   • Up to 3 attempts per job; final failure is marked status="failed".
 *   • Idempotency inside distributeCommissions (eventRefId guard) prevents
 *     double payouts even if a job is retried after a partial success.
 *
 * Job types:
 *   distribute_commissions  — runs distributeCommissions()
 *   pay_referral_bonus      — runs payReferralBonusOnFirstVIP()
 */
import { db } from "../db";
import { distributeCommissions, CommissionEvent } from "../modules/affiliates/commissions";
import { payReferralBonusOnFirstVIP } from "../modules/referrals/referrals.service";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const BATCH_SIZE       = 20;     // jobs per poll tick
const MAX_ATTEMPTS     = 3;

// ── Payload types ─────────────────────────────────────────────────────────────

interface DistributeCommissionsPayload {
  sourceUserId: string;
  eventType:    CommissionEvent;
  grossAmount:  number;
  eventRefId?:  string;
}

interface PayReferralBonusPayload {
  referredUserId: string;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export async function enqueueDistributeCommissions(
  opts: DistributeCommissionsPayload
): Promise<void> {
  await db.commissionJob.create({
    data: {
      jobType: "distribute_commissions",
      payload: JSON.stringify(opts),
    },
  });
}

export async function enqueuePayReferralBonus(referredUserId: string): Promise<void> {
  await db.commissionJob.create({
    data: {
      jobType: "pay_referral_bonus",
      payload: JSON.stringify({ referredUserId } satisfies PayReferralBonusPayload),
    },
  });
}

// ── Worker ────────────────────────────────────────────────────────────────────

async function executeJob(jobId: string, jobType: string, payload: string): Promise<void> {
  if (jobType === "distribute_commissions") {
    const p = JSON.parse(payload) as DistributeCommissionsPayload;
    // Guarantee idempotency for every event type, even when the caller omitted
    // eventRefId. The job ID is globally unique, so using it as the fallback key
    // ensures the commission is distributed exactly once per job record, even
    // across retries after a partial failure.
    if (!p.eventRefId) {
      p.eventRefId = `job_${jobId}`;
    }
    await distributeCommissions(p);
  } else if (jobType === "pay_referral_bonus") {
    const p = JSON.parse(payload) as PayReferralBonusPayload;
    await payReferralBonusOnFirstVIP(p.referredUserId);
  } else {
    throw new Error(`Unknown commission job type: ${jobType}`);
  }
}

async function processPendingJobs(): Promise<void> {
  // Find pending jobs that still have remaining attempts
  const jobs = await db.commissionJob.findMany({
    where:   { status: "pending", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take:    BATCH_SIZE,
  });

  for (const job of jobs) {
    // Atomically claim the job — if another tick already claimed it, skip
    const claimed = await db.commissionJob.updateMany({
      where: { id: job.id, status: "pending" },
      data:  { status: "processing" },
    });
    if (claimed.count === 0) continue;

    const newAttempts = job.attempts + 1;

    try {
      await executeJob(job.id, job.jobType, job.payload);
      await db.commissionJob.update({
        where: { id: job.id },
        data:  { status: "completed", attempts: newAttempts, processedAt: new Date(), errorMessage: null },
      });
    } catch (err) {
      const isFinalAttempt = newAttempts >= MAX_ATTEMPTS;
      await db.commissionJob.update({
        where: { id: job.id },
        data:  {
          status:       isFinalAttempt ? "failed" : "pending",
          attempts:     newAttempts,
          errorMessage: String(err),
        },
      });
      console.error(`[CommissionJob] ${job.jobType} job ${job.id} failed (attempt ${newAttempts}/${MAX_ATTEMPTS}):`, err);
    }
  }
}

// Recover any jobs stuck in "processing" from a prior server crash
async function recoverStuckJobs(): Promise<void> {
  const stuckCount = await db.commissionJob.updateMany({
    where:  { status: "processing" },
    data:   { status: "pending" },
  });
  if (stuckCount.count > 0) {
    console.log(`[CommissionJob] Recovered ${stuckCount.count} stuck job(s) from prior crash`);
  }
}

export function startCommissionJobWorker(): NodeJS.Timeout {
  // On startup, recover any jobs that were processing when the server crashed
  recoverStuckJobs().catch(err => console.error("[CommissionJob] Startup recovery failed:", err));

  const timer = setInterval(async () => {
    try {
      await processPendingJobs();
    } catch (err) {
      console.error("[CommissionJob] Worker poll failed:", err);
    }
  }, POLL_INTERVAL_MS);

  // Don't prevent graceful shutdown
  timer.unref();

  console.log(`[CommissionJob] Worker started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  return timer;
}
