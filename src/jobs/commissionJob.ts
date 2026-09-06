/**
 * DB-backed job queue used by commissions/referrals and task-proof verification.
 * Jobs are written before the HTTP response returns, survive crashes, and are
 * claimed atomically so multiple Render instances do not execute the same job.
 */
import { db } from "../db";
import { distributeCommissions, CommissionEvent } from "../modules/affiliates/commissions";
import { payReferralBonusOnFirstVIP } from "../modules/referrals/referrals.service";
import { processAIVerification } from "../modules/tasks/proofs.service";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;

interface DistributeCommissionsPayload {
  sourceUserId: string;
  eventType: CommissionEvent;
  grossAmount: number;
  eventRefId?: string;
}

interface PayReferralBonusPayload { referredUserId: string; }
interface VerifyTaskProofPayload { proofId: string; }

export async function enqueueDistributeCommissions(opts: DistributeCommissionsPayload): Promise<void> {
  await db.commissionJob.create({ data: { jobType: "distribute_commissions", payload: JSON.stringify(opts) } });
}

export async function enqueuePayReferralBonus(referredUserId: string): Promise<void> {
  await db.commissionJob.create({ data: { jobType: "pay_referral_bonus", payload: JSON.stringify({ referredUserId } satisfies PayReferralBonusPayload) } });
}

async function executeJob(jobId: string, jobType: string, payload: string): Promise<void> {
  if (jobType === "distribute_commissions") {
    const p = JSON.parse(payload) as DistributeCommissionsPayload;
    if (!p.eventRefId) p.eventRefId = `job_${jobId}`;
    await distributeCommissions(p);
  } else if (jobType === "pay_referral_bonus") {
    const p = JSON.parse(payload) as PayReferralBonusPayload;
    await payReferralBonusOnFirstVIP(p.referredUserId);
  } else if (jobType === "verify_task_proof") {
    const p = JSON.parse(payload) as VerifyTaskProofPayload;
    if (!p.proofId) throw new Error("verify_task_proof job is missing proofId");
    await processAIVerification(p.proofId);
  } else {
    throw new Error(`Unknown commission job type: ${jobType}`);
  }
}

async function processPendingJobs(): Promise<void> {
  const jobs = await db.commissionJob.findMany({ where: { status: "pending", attempts: { lt: MAX_ATTEMPTS } }, orderBy: { createdAt: "asc" }, take: BATCH_SIZE });
  for (const job of jobs) {
    const claimed = await db.commissionJob.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "processing" } });
    if (claimed.count === 0) continue;
    const newAttempts = job.attempts + 1;
    try {
      await executeJob(job.id, job.jobType, job.payload);
      await db.commissionJob.update({ where: { id: job.id }, data: { status: "completed", attempts: newAttempts, processedAt: new Date(), errorMessage: null } });
    } catch (err) {
      const isFinalAttempt = newAttempts >= MAX_ATTEMPTS;
      await db.commissionJob.update({ where: { id: job.id }, data: { status: isFinalAttempt ? "failed" : "pending", attempts: newAttempts, errorMessage: String(err) } });
      console.error(`[CommissionJob] ${job.jobType} job ${job.id} failed (attempt ${newAttempts}/${MAX_ATTEMPTS}):`, err);
    }
  }
}

async function recoverStuckJobs(): Promise<void> {
  const stuckCount = await db.commissionJob.updateMany({ where: { status: "processing" }, data: { status: "pending" } });
  if (stuckCount.count > 0) console.log(`[CommissionJob] Recovered ${stuckCount.count} stuck job(s) from prior crash`);
}

export function startCommissionJobWorker(): NodeJS.Timeout {
  recoverStuckJobs().catch(err => console.error("[CommissionJob] Startup recovery failed:", err));
  const timer = setInterval(async () => {
    try { await processPendingJobs(); }
    catch (err) { console.error("[CommissionJob] Worker poll failed:", err); }
  }, POLL_INTERVAL_MS);
  timer.unref();
  console.log(`[CommissionJob] Worker started — polling every ${POLL_INTERVAL_MS / 1000}s`);
  return timer;
}
