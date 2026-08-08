/**
 * Task Proof Service
 *
 * Flow:
 *   POST /tasks/:id/proofs
 *     → creates TaskProof record (status: pending_ai)
 *     → stores proof screenshots in object storage
 *     → fires processAIVerification() via setImmediate (fire-and-forget)
 *     → returns immediately
 *
 *   GET /tasks/:id/proofs/me
 *     → frontend polls this until status != pending_ai
 *
 *   processAIVerification()
 *     → calls verifyTaskProof() (Claude Vision, server-side)
 *     → on approved: credits reward to user's task wallet, increments task.completedSlots
 *     → on review:   creates AdminProofReview record
 *     → on rejected: updates status, no reward
 *
 * Commission distribution for approved proofs is enqueued inside the $transaction
 * as a CommissionJob record, so it survives server restarts.
 * AI verification itself remains fire-and-forget (non-financial, best-effort).
 */
import { db } from "../../db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storeDocument } from "../kyc/storage";
import { verifyTaskProof } from "../ai/claudeVision";
import { resolveUserTier } from "../withdrawals/limits";
import { creditWallet, debitWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getTaskRewardSplit } from "./tasks.service";

const MAX_PROOF_SCREENSHOTS = 3;

// ── Submit proof ──────────────────────────────────────────────────────────────

export async function submitProof(userId: string, taskId: string, input: {
  screenshotDataUrls: string[];
  proofNote?: string;
  proofLink?: string;
}) {
  // Validate task exists and is active
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { referenceScreenshots: { orderBy: { slot: "asc" } } },
  });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "active") {
    throw Object.assign(new Error(`Task is not accepting submissions — status: ${task.status}`), {
      statusCode: 400, code: "TASK_NOT_ACTIVE",
    });
  }
  if (task.completedSlots >= task.totalSlots) {
    throw Object.assign(new Error("Task has no remaining slots"), { statusCode: 409, code: "TASK_FULL" });
  }
  // Prevent user submitting their own task
  if (task.advertiserId === userId) {
    throw Object.assign(new Error("You cannot submit proof for your own task"), { statusCode: 400, code: "OWN_TASK" });
  }

  // Anti-replay — @@unique([taskId, userId]) enforced in DB too
  const existing = await db.taskProof.findUnique({ where: { taskId_userId: { taskId, userId } } });
  if (existing) {
    throw Object.assign(new Error("You have already submitted proof for this task"), {
      statusCode: 409, code: "ALREADY_SUBMITTED",
    });
  }

  // Store screenshots
  const screenshots = input.screenshotDataUrls.slice(0, MAX_PROOF_SCREENSHOTS);
  const storedKeys: Array<{ key: string; slot: number }> = [];
  for (let i = 0; i < screenshots.length; i++) {
    if (screenshots[i].startsWith("data:")) {
      const stored = await storeDocument(screenshots[i], `tasks/proofs/${taskId}/${userId}`);
      storedKeys.push({ key: stored.key, slot: i });
    }
  }

  // Calculate reward for this user's tier
  const tier = await resolveUserTier(userId);
  const rewardAmount = task.rewardPerSlot * await getTaskRewardSplit(tier);

  // Create proof record
  const proof = await db.taskProof.create({
    data: {
      taskId, userId, rewardAmount,
      screenshots: {
        create: storedKeys.map(s => ({ storageKey: s.key, slot: s.slot })),
      },
    },
    include: { screenshots: true },
  });

  // Fire-and-forget AI verification
  const referenceUrls = task.referenceScreenshots.map(s =>
    `/uploads/${s.storageKey}`  // In production, use presigned S3 URLs
  );
  setImmediate(() => processAIVerification(
    proof.id, taskId, userId, rewardAmount,
    storedKeys.map(s => `/uploads/${s.key}`),
    referenceUrls,
    task.proofInstructions ?? task.title,
    task.type,
  ));

  return serializeProof(proof);
}

// ── Async AI verification ─────────────────────────────────────────────────────

/** Load a stored file and convert to base64 data URL for Claude Vision. */
function loadAsDataUrl(storagePath: string): string | null {
  try {
    // storagePath is like "/uploads/tasks/proofs/..." — strip leading slash
    const relativePath = storagePath.replace(/^\//, "");
    const fullPath = join(process.cwd(), relativePath);
    if (!existsSync(fullPath)) return null;
    const buffer = readFileSync(fullPath);
    // Detect MIME type from extension
    const ext = fullPath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
    const mimeType = mimeMap[ext] ?? "image/jpeg";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function processAIVerification(
  proofId:              string,
  taskId:               string,
  userId:               string,
  rewardAmount:         number,
  proofUrls:            string[],
  referenceUrls:        string[],
  taskInstructions:     string,
  categorySlug:         string,
): Promise<void> {
  try {
    // Load actual file content for Claude Vision — convert from storage path to base64 data URL.
    // In S3 mode: replace with presigned URL fetch + base64 conversion.
    const proofDataUrls = proofUrls
      .map(url => loadAsDataUrl(url))
      .filter((u): u is string => u !== null);
    const refDataUrls = referenceUrls
      .map(url => loadAsDataUrl(url))
      .filter((u): u is string => u !== null);

    const verdict = await verifyTaskProof({
      proofScreenshots:     proofDataUrls,
      referenceScreenshots: refDataUrls,
      taskInstructions,
      categorySlug,
    });

    const now = new Date();

    if (verdict.verdict === "approved") {
      await db.$transaction(async (tx) => {
        // Atomic guard: claim the "pending_ai → approved" transition inside the transaction.
        // If processAIVerification is retried (e.g. after a crash), the second call gets
        // count=0 and exits without re-crediting the reward — preventing double-credit.
        const guard = await tx.taskProof.updateMany({
          where: { id: proofId, status: "pending_ai" },
          data: {
            status: "approved", aiConfidence: verdict.confidence,
            aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict,
            rewardPaid: true, processedAt: now,
          },
        });
        if (guard.count === 0) return; // Already processed — idempotency guard

        // Slot cap guard: atomically claim one slot. Two concurrent AI approvals for
        // different users on the same task both pass the pre-submission completedSlots
        // check (read outside any transaction), but only one can win this updateMany —
        // preventing the advertiser's task_vault from being over-debited.
        const taskSnap = await tx.task.findUnique({ where: { id: taskId }, select: { totalSlots: true, completedSlots: true } });
        if (!taskSnap) return;
        const slotGuard = await tx.task.updateMany({
          where: { id: taskId, completedSlots: { lt: taskSnap.totalSlots } },
          data:  { completedSlots: { increment: 1 } },
        });
        if (slotGuard.count === 0) {
          // All slots already filled by a concurrent approval — undo proof approval status.
          await tx.taskProof.update({ where: { id: proofId }, data: { status: "rejected", rewardPaid: false, aiAnalysis: "Task slots filled by concurrent approval." } });
          return;
        }

        await creditWallet(tx, userId, "task", rewardAmount);
        const proof = await tx.taskProof.findUnique({ where: { id: proofId }, include: { task: true } });
        if (proof?.task.advertiserId && rewardAmount > 0) {
          await debitWallet(tx, proof.task.advertiserId, "task_vault", rewardAmount);
          await writeLedgerEntry(tx, {
            userId: proof.task.advertiserId, type: "transfer", fromWallet: "task_vault",
            amount: rewardAmount, description: "Task proof approved — worker paid",
            referenceId: proofId, referenceType: "task_proof", metadata: { taskId, workerId: userId },
          });
        }
        await writeLedgerEntry(tx, {
          userId, type: "task_reward", toWallet: "task", amount: rewardAmount,
          description: "Task completed — reward credited",
          referenceId: proofId, referenceType: "task_proof", metadata: { taskId },
        });
        // completedSlots is already incremented by slotGuard above.
        // Enqueue commission job INSIDE the transaction — atomic with reward payment.
        // If transaction rolls back, no job is enqueued. If it commits, job survives restarts.
        if (rewardAmount > 0) {
          await tx.commissionJob.create({
            data: {
              jobType: "distribute_commissions",
              payload: JSON.stringify({
                sourceUserId: userId,
                eventType:    "task_completion",
                grossAmount:  rewardAmount,
                eventRefId:   proofId,
              }),
            },
          });
        }
      });

    } else if (verdict.verdict === "review") {
      await db.taskProof.update({
        where: { id: proofId },
        data: { status: "review", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now },
      });
      await db.adminProofReview.create({
        data: { proofId, taskId, userId, aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis },
      });

    } else { // rejected
      await db.taskProof.update({
        where: { id: proofId },
        data: { status: "rejected", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now },
      });
    }
  } catch (err) {
    console.error(`[ProofVerify] Failed for proof ${proofId}:`, err);
    await db.taskProof.update({
      where: { id: proofId },
      data: { status: "review", aiConfidence: 72, aiAnalysis: "Verification error — queued for manual review.", processedAt: new Date() },
    }).catch(() => {});
    await db.adminProofReview.create({
      data: { proofId, taskId, userId, aiConfidence: 72, aiAnalysis: "Processing error — manual review needed." },
    }).catch(() => {});
  }
}

// ── Get user's proof for a task ───────────────────────────────────────────────

export async function getMyProof(userId: string, taskId: string) {
  const proof = await db.taskProof.findUnique({
    where: { taskId_userId: { taskId, userId } },
    include: { screenshots: { orderBy: { slot: "asc" } } },
  });
  if (!proof) return null;
  return serializeProof(proof);
}

// ── Serializer ────────────────────────────────────────────────────────────────

export function serializeProof(p: any) {
  return {
    id:            p.id,
    taskId:        p.taskId,
    userId:        p.userId,
    status:        p.status,
    aiConfidence:  p.aiConfidence ?? null,
    aiAnalysis:    p.aiAnalysis ?? null,
    rewardPaid:    p.rewardPaid,
    rewardAmount:  p.rewardAmount ?? null,
    processedAt:   p.processedAt?.toISOString() ?? null,
    submittedAt:   p.submittedAt.toISOString(),
    screenshotCount: p.screenshots?.length ?? 0,
  };
}
