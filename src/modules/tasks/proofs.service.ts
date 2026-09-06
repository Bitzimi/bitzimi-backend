import { db } from "../../db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storeDocument } from "../kyc/storage";
import { verifyTaskProof } from "../ai/claudeVision";
import { resolveUserTier } from "../withdrawals/limits";
import { creditWallet, debitWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getTaskRewardSplit } from "./tasks.service";

const MAX_PROOF_SCREENSHOTS = 3;

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
    if (!screenshots[i].startsWith("data:")) throw Object.assign(new Error("Proof screenshots must be uploaded as data URLs"), { statusCode: 400, code: "INVALID_PROOF_FILE" });
    const stored = await storeDocument(screenshots[i], `tasks/proofs/${taskId}/${userId}`);
    storedKeys.push({ key: stored.key, slot: i });
  }

  const tier = await resolveUserTier(userId);
  const rewardAmount = task.rewardPerSlot * await getTaskRewardSplit(tier);
  const proof = await db.taskProof.create({ data: { taskId, userId, rewardAmount, screenshots: { create: storedKeys.map(s => ({ storageKey: s.key, slot: s.slot })) } }, include: { screenshots: true } });
  const referenceUrls = task.referenceScreenshots.map(s => `/uploads/${s.storageKey}`);
  setImmediate(() => processAIVerification(proof.id, taskId, userId, rewardAmount, storedKeys.map(s => `/uploads/${s.key}`), referenceUrls, task.proofInstructions ?? task.title, task.type));
  return serializeProof(proof);
}

function loadAsDataUrl(storagePath: string): string | null {
  try {
    const relativePath = storagePath.replace(/^\//, "");
    const fullPath = join(process.cwd(), relativePath);
    if (!existsSync(fullPath)) return null;
    const buffer = readFileSync(fullPath);
    const ext = fullPath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
    return `data:${mimeMap[ext] ?? "image/jpeg"};base64,${buffer.toString("base64")}`;
  } catch { return null; }
}

async function processAIVerification(proofId: string, taskId: string, userId: string, rewardAmount: number, proofUrls: string[], referenceUrls: string[], taskInstructions: string, categorySlug: string): Promise<void> {
  try {
    const proofDataUrls = proofUrls.map(loadAsDataUrl).filter((u): u is string => u !== null);
    const refDataUrls = referenceUrls.map(loadAsDataUrl).filter((u): u is string => u !== null);
    const verdict = await verifyTaskProof({ proofScreenshots: proofDataUrls, referenceScreenshots: refDataUrls, taskInstructions, categorySlug });
    const now = new Date();
    if (verdict.verdict === "approved") {
      await db.$transaction(async (tx) => {
        const guard = await tx.taskProof.updateMany({ where: { id: proofId, status: "pending_ai", rewardPaid: false }, data: { status: "approved", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, rewardPaid: true, processedAt: now } });
        if (guard.count === 0) return;
        const taskSnap = await tx.task.findUnique({ where: { id: taskId }, select: { totalSlots: true, completedSlots: true, status: true } });
        if (!taskSnap || taskSnap.status !== "active") throw Object.assign(new Error("Task is no longer active"), { code: "TASK_NOT_ACTIVE" });
        const slotGuard = await tx.task.updateMany({ where: { id: taskId, status: "active", completedSlots: { lt: taskSnap.totalSlots } }, data: { completedSlots: { increment: 1 } } });
        if (slotGuard.count === 0) throw Object.assign(new Error("Task slots filled by concurrent approval"), { code: "TASK_FULL" });
        if (taskSnap.completedSlots + 1 >= taskSnap.totalSlots) await tx.task.update({ where: { id: taskId }, data: { status: "completed" } });
        await creditWallet(tx, userId, "task", rewardAmount);
        const proof = await tx.taskProof.findUnique({ where: { id: proofId }, include: { task: true } });
        if (proof?.task.advertiserId && rewardAmount > 0) {
          await debitWallet(tx, proof.task.advertiserId, "task_vault", rewardAmount);
          await writeLedgerEntry(tx, { userId: proof.task.advertiserId, type: "transfer", fromWallet: "task_vault", amount: rewardAmount, description: "Task proof approved — worker paid", referenceId: proofId, referenceType: "task_proof", metadata: { taskId, workerId: userId } });
        }
        await writeLedgerEntry(tx, { userId, type: "task_reward", toWallet: "task", amount: rewardAmount, description: "Task completed — reward credited", referenceId: proofId, referenceType: "task_proof", metadata: { taskId } });
        if (rewardAmount > 0) await tx.commissionJob.create({ data: { jobType: "distribute_commissions", payload: JSON.stringify({ sourceUserId: userId, eventType: "task_completion", grossAmount: rewardAmount, eventRefId: proofId }) } });
      });
    } else if (verdict.verdict === "review") {
      await db.taskProof.update({ where: { id: proofId }, data: { status: "review", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now } });
      await db.adminProofReview.upsert({ where: { proofId }, create: { proofId, taskId, userId, aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis }, update: { aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis } });
    } else {
      await db.taskProof.update({ where: { id: proofId }, data: { status: "rejected", aiConfidence: verdict.confidence, aiAnalysis: verdict.analysis, aiVerdict: verdict.verdict, processedAt: now } });
    }
  } catch (err) {
    console.error(`[ProofVerify] Failed for proof ${proofId}:`, err);
    await db.taskProof.updateMany({ where: { id: proofId, status: "pending_ai" }, data: { status: "review", aiConfidence: null, aiAnalysis: "Verification error — queued for manual review.", processedAt: new Date() } });
    await db.adminProofReview.upsert({ where: { proofId }, create: { proofId, taskId, userId, aiAnalysis: "Processing error — manual review needed." }, update: { aiAnalysis: "Processing error — manual review needed." } }).catch(() => {});
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
