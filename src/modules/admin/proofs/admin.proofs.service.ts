import { db } from "../../../db";
import { creditWallet, debitWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { serializeProof } from "../../tasks/proofs.service";
import { createNotification } from "../../notifications/notifications.service";

export async function getProofReviewQueue(opts: { includeDecided?: boolean } = {}) {
  const where: any = {};
  if (!opts.includeDecided) where.decision = null;
  const items = await db.adminProofReview.findMany({
    where, orderBy: { createdAt: "asc" },
    include: { proof: { include: { screenshots: { orderBy: { slot: "asc" } }, task: { select: { title: true, proofInstructions: true, referenceScreenshots: { orderBy: { slot: "asc" } } } }, user: { include: { profile: { select: { username: true } } } } } },
  });
  return items.map(r => ({
    reviewId: r.id, proofId: r.proofId, taskId: r.taskId, aiConfidence: r.aiConfidence, aiAnalysis: r.aiAnalysis,
    decision: r.decision, decisionNote: r.decisionNote ?? null, reviewedAt: r.reviewedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    proof: serializeProof(r.proof),
    task: { title: r.proof.task.title, proofInstructions: r.proof.task.proofInstructions, referenceScreenshotUrls: r.proof.task.referenceScreenshots.map(s => `/uploads/${s.storageKey}`) },
    proofScreenshotUrls: r.proof.screenshots.map(s => `/uploads/${s.storageKey}`),
    username: r.proof.user.profile?.username ?? "",
  }));
}

export async function adminListProofs(opts: { status?: string; cursor?: string; limit?: number }) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) { const anchor = await db.taskProof.findUnique({ where: { id: cursor } }); if (anchor) where.submittedAt = { lt: anchor.submittedAt }; }
  const rows = await db.taskProof.findMany({ where, orderBy: { submittedAt: "desc" }, take: limit + 1, include: { screenshots: true } });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items: items.map(serializeProof), nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
}

export async function adminDecideProof(reviewId: string, reviewerId: string, decision: "approved" | "rejected", note?: string) {
  const review = await db.adminProofReview.findUnique({ where: { id: reviewId } });
  if (!review) throw Object.assign(new Error("Review item not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (review.decision) throw Object.assign(new Error(`Already decided: ${review.decision}`), { statusCode: 409, code: "ALREADY_DECIDED" });
  const proof = await db.taskProof.findUnique({ where: { id: review.proofId }, include: { task: true } });
  if (!proof) throw Object.assign(new Error("Proof not found"), { statusCode: 404, code: "NOT_FOUND" });
  const now = new Date();

  if (decision === "approved") {
    await db.$transaction(async (tx) => {
      const reviewGuard = await tx.adminProofReview.updateMany({ where: { id: reviewId, decision: null }, data: { decision, decisionNote: note, reviewedBy: reviewerId, reviewedAt: now } });
      if (reviewGuard.count === 0) throw Object.assign(new Error("Review item was already decided"), { statusCode: 409, code: "ALREADY_DECIDED" });

      const proofGuard = await tx.taskProof.updateMany({ where: { id: review.proofId, status: "review", rewardPaid: false }, data: { status: "admin_approved", rewardPaid: true, processedAt: now } });
      if (proofGuard.count === 0) throw Object.assign(new Error("Proof is no longer awaiting manual review"), { statusCode: 409, code: "ALREADY_PROCESSED" });

      const taskSnap = await tx.task.findUnique({ where: { id: review.taskId }, select: { status: true, totalSlots: true, completedSlots: true } });
      if (!taskSnap || taskSnap.status !== "active") throw Object.assign(new Error("Task is no longer active"), { statusCode: 409, code: "TASK_NOT_ACTIVE" });
      const slotGuard = await tx.task.updateMany({ where: { id: review.taskId, status: "active", completedSlots: { lt: taskSnap.totalSlots } }, data: { completedSlots: { increment: 1 } } });
      if (slotGuard.count === 0) throw Object.assign(new Error("Task has no remaining slots"), { statusCode: 409, code: "TASK_FULL" });
      if (taskSnap.completedSlots + 1 >= taskSnap.totalSlots) await tx.task.update({ where: { id: review.taskId }, data: { status: "completed" } });

      const rewardAmount = proof.rewardAmount ?? 0;
      if (rewardAmount > 0) {
        await creditWallet(tx, proof.userId, "task", rewardAmount);
        await debitWallet(tx, proof.task.advertiserId, "task_vault", rewardAmount);
        await writeLedgerEntry(tx, { userId: proof.userId, type: "task_reward", toWallet: "task", amount: rewardAmount, description: "Task proof admin-approved — reward credited", referenceId: review.proofId, referenceType: "task_proof" });
        await writeLedgerEntry(tx, { userId: proof.task.advertiserId, type: "transfer", fromWallet: "task_vault", amount: rewardAmount, description: "Task proof admin-approved — worker paid", referenceId: review.proofId, referenceType: "task_proof", metadata: { workerId: proof.userId } });
        await tx.commissionJob.create({ data: { jobType: "distribute_commissions", payload: JSON.stringify({ sourceUserId: proof.userId, eventType: "task_completion", grossAmount: rewardAmount, eventRefId: review.proofId }) } });
      }
    });
  } else {
    await db.$transaction(async (tx) => {
      const reviewGuard = await tx.adminProofReview.updateMany({ where: { id: reviewId, decision: null }, data: { decision, decisionNote: note, reviewedBy: reviewerId, reviewedAt: now } });
      if (reviewGuard.count === 0) throw Object.assign(new Error("Review item was already decided"), { statusCode: 409, code: "ALREADY_DECIDED" });
      const proofGuard = await tx.taskProof.updateMany({ where: { id: review.proofId, status: "review", rewardPaid: false }, data: { status: "admin_rejected", processedAt: now } });
      if (proofGuard.count === 0) throw Object.assign(new Error("Proof is no longer awaiting manual review"), { statusCode: 409, code: "ALREADY_PROCESSED" });
    });
  }

  const notifType = decision === "approved" ? "proof_approved" : "proof_rejected";
  const notifTitle = decision === "approved" ? "Proof Approved ✅" : "Proof Rejected";
  const notifMessage = decision === "approved" ? "Your task proof has been reviewed and approved. Reward has been credited to your task wallet." : `Your task proof was reviewed and rejected${note ? `: ${note}` : "."}`;
  setImmediate(() => createNotification({ userId: proof.userId, type: notifType, title: notifTitle, message: notifMessage, metadata: { reviewId, taskId: review.taskId, decision, note } }));
  return { reviewId, decision, decidedAt: now.toISOString() };
}
