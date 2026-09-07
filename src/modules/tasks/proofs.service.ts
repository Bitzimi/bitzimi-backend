import { db } from "../../db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storeDocument } from "../kyc/storage";
import { verifyTaskProof } from "../ai/claudeVision";
import { resolveUserTier } from "../withdrawals/limits";
import { creditWallet, debitWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getTaskRewardSplit } from "./tasks.service";

const MAX_PROOF_SCREENSHOTS = 3;
const ALLOWED_PROOF_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function submitProof(userId: string, taskId: string, input: { screenshotDataUrls: string[]; proofNote?: string; proofLink?: string }) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: { referenceScreenshots: { orderBy: { slot: "asc" } } } });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "active") throw Object.assign(new Error(`Task is not accepting submissions — status: ${task.status}`), { statusCode: 400, code: "TASK_NOT_ACTIVE" });
  if (task.expiresAt && task.expiresAt <= new Date()) throw Object.assign(new Error("Task has expired"), { statusCode: 400, code: "TASK_EXPIRED" });
  if (task.completedSlots >= task.totalSlots) throw Object.assign(new Error("Task has no remaining slots"), { statusCode: 409, code: "TASK_FULL" });
  if (task.advertiserId === userId) throw Object.assign(new Error("You cannot submit proof for your own task"), { statusCode: 400, code: "OWN_TASK" });
  const existing = await db.taskProof.findUnique({ where: { taskId_userId: { taskId, userId } } });
  if (existing) throw Object.assign(new Error("You have already submitted proof for this task"), { statusCode: 409, code: "ALREADY_SUBMITTED" });

  const screenshots = input.screenshotDataUrls.slice(0, MAX_PROOF_SCREENSHOTS);
  const storedKeys: Array<{ key: string; slot: number }> = [];
  for (let i = 0; i < screenshots.length; i++) {
    const match = screenshots[i].match(/^data:([^;]+);base64,/);
    if (!match || !ALLOWED_PROOF_MIME_TYPES.has(match[1].toLowerCase())) {
      throw Object.assign(new Error("Proof screenshots must be JPEG, PNG, or WebP images"), { statusCode: 400, code: "INVALID_PROOF_FILE" });
    }
    const stored = await storeDocument(screenshots[i], `tasks/proofs/${taskId}/${userId}`);
    storedKeys.push({ key: stored.key, slot: i });
  }

  const tier = await resolveUserTier(userId);
  const rewardAmount = task.rewardPerSlot * await getTaskRewardSplit(tier);
  const proof = await db.$transaction(async (tx) => {
    const created = await tx.taskProof.create({
      data: {
        taskId,
        userId,
        rewardAmount,
        screenshots: { create: storedKeys.map(s => ({ storageKey: s.key, slot: s.slot })) },
      },
      include: { screenshots: true },
    });

    // Queue verification in the existing DB-backed job queue before returning.
    // This replaces process-local setImmediate work and survives a server restart.
    await tx.commissionJob.create({
      data: {
        jobType: "verify_task_proof",
        payload: JSON.stringify({ proofId: created.id }),
      },
    });
    return created;
  });

  return serializeProof(proof);
}

function loadAsDataUrl(storagePath: string): string | null {
  try {
    const relativePath = storagePath.replace(/^\//, "");
    const fullPath = join(process.cwd(), relativePath);
    if (!existsSync(fullPath)) return null;
    const buffer = readFileSync(fullPath);
    const ext = fullPath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    return `data:${mimeMap[ext] ?? "image/jpeg"};base64,${buffer.toString("base64")}`;
  } catch { return null; }
}

export async function processAIVerification(proofId: string): Promise<void> {
  const proof = await db.taskProof.findUnique({
    where: { id: proofId },
    include: { screenshots: { orderBy: { slot: "asc" } }, task: { include: { referenceScreenshots: { orderBy: { slot: "asc" } } } } },
  });
  if (!proof || proof.status !== "pending_ai" || proof.rewardPaid) return;

  const proofDataUrls = proof.screenshots.map(s => loadAsDataUrl(`/uploads/${s.storageKey}`)).filter((u): u is string => u !== null);
  const refDataUrls = proof.task.referenceScreenshots.map(s => loadAsDataUrl(`/uploads/${s.storageKey}`)).filter((u): u is string => u !== null);
  const taskInstructions = proof.task.proofInstructions ?? proof.task.title;
  const categorySlug = proof.task.type;

  try {
    const verdict = await verifyTaskProof({ proofScreenshots: proofDataUrls, referenceScreenshots: refDataUrls, taskInstructions, categorySlug });
    const now = new Date();
    if (verdict.verdict === "approved") {
      await db.$transaction(async (tx) => {
        const guard = await tx.taskProof.updateMany({ where: { id: proofId, status: "pending_ai", rewardPaid: false }, data: { status: "approved", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, rewardPaid: true, processedAt: now } });
        if (guard.count === 0) return;
        const taskSnap = await tx.task.findUnique({ where: { id: proof.taskId }, select: { totalSlots: true, completedSlots: true, status: true } });
        if (!taskSnap || taskSnap.status !== "active") throw Object.assign(new Error("Task is no longer active"), { code: "TASK_NOT_ACTIVE" });
        const slotGuard = await tx.task.updateMany({ where: { id: proof.taskId, status: "active", completedSlots: { lt: taskSnap.totalSlots } }, data: { completedSlots: { increment: 1 } } });
        if (slotGuard.count === 0) throw Object.assign(new Error("Task slots filled by concurrent approval"), { code: "TASK_FULL" });
        if (taskSnap.completedSlots + 1 >= taskSnap.totalSlots) await tx.task.update({ where: { id: proof.taskId }, data: { status: "completed" } });
        await creditWallet(tx, proof.userId, "task", proof.rewardAmount ?? 0);
        if ((proof.rewardAmount ?? 0) > 0) {
          await debitWallet(tx, proof.task.advertiserId, "task_vault", proof.rewardAmount ?? 0);
          await writeLedgerEntry(tx, { userId: proof.task.advertiserId, type: "transfer", fromWallet: "task_vault", amount: proof.rewardAmount ?? 0, description: "Task proof approved — worker paid", referenceId: proofId, referenceType: "task_proof", metadata: { taskId: proof.taskId, workerId: proof.userId } });
        }
        await writeLedgerEntry(tx, { userId: proof.userId, type: "task_reward", toWallet: "task", amount: proof.rewardAmount ?? 0, description: "Task completed — reward credited", referenceId: proofId, referenceType: "task_proof", metadata: { taskId: proof.taskId, sourceLabel: `Task: ${proof.task.title}`, destinationLabel: "Task Wallet" } });
        if ((proof.rewardAmount ?? 0) > 0) await tx.commissionJob.create({ data: { jobType: "distribute_commissions", payload: JSON.stringify({ sourceUserId: proof.userId, eventType: "task_completion", grossAmount: proof.rewardAmount ?? 0, eventRefId: proofId }) } });
      });
    } else if (verdict.verdict === "review") {
      await db.taskProof.updateMany({ where: { id: proofId, status: "pending_ai", rewardPaid: false }, data: { status: "review", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now } });
      await db.adminProofReview.upsert({ where: { proofId }, create: { proofId, taskId: proof.taskId, userId: proof.userId, aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis }, update: { aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis } });
    } else {
      await db.taskProof.updateMany({ where: { id: proofId, status: "pending_ai", rewardPaid: false }, data: { status: "rejected", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now } });
    }
  } catch (err) {
    console.error(`[ProofVerify] Failed for proof ${proofId}:`, err);
    await db.taskProof.updateMany({ where: { id: proofId, status: "pending_ai" }, data: { status: "review", aiConfidence: null, aiAnalysis: "Verification error — queued for manual review.", processedAt: new Date() } });
    await db.adminProofReview.upsert({ where: { proofId }, create: { proofId, taskId: proof.taskId, userId: proof.userId, aiAnalysis: "Processing error — manual review needed." }, update: { aiAnalysis: "Processing error — manual review needed." } }).catch(() => {});
  }
}

export async function getMyProof(userId: string, taskId: string) {
  const proof = await db.taskProof.findUnique({ where: { taskId_userId: { taskId, userId } }, include: { screenshots: { orderBy: { slot: "asc" } } } });
  if (!proof) return null;
  return serializeProof(proof);
}

export function serializeProof(p: any) {
  return { id: p.id, taskId: p.taskId, userId: p.userId, status: p.status, aiConfidence: p.aiConfidence ?? null, aiAnalysis: p.aiAnalysis ?? null, rewardPaid: p.rewardPaid, rewardAmount: p.rewardAmount ?? null, processedAt: p.processedAt?.toISOString() ?? null, submittedAt: p.submittedAt.toISOString(), screenshotCount: p.screenshots?.length ?? 0 };
}
