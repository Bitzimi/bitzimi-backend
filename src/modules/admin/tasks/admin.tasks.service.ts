import { db } from "../../../db";
import { dec } from "../../../utils/dec";
import { serializeTask } from "../../tasks/tasks.service";
import { serializeProof } from "../../tasks/proofs.service";
import { creditWallet, debitWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { createNotification } from "../../notifications/notifications.service";
// Phase 21 — fire-and-forget hooks for featured placement lifecycle
import {
  handleFeaturedRequestOnTaskApproved,
  handleFeaturedRequestOnTaskRejected,
} from "../../promotions/promotions.service";

export async function adminListTasks(opts: { status?: string; cursor?: string; limit?: number }) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) {
    const anchor = await db.task.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }
  const rows = await db.task.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
    include: { referenceScreenshots: { orderBy: { slot: "asc" } } },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items: items.map(t => serializeTask(t, true)), nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
}

export async function adminGetTaskDetail(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { referenceScreenshots: { orderBy: { slot: "asc" } } },
  });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });

  const proofs = await db.taskProof.findMany({
    where: { taskId },
    orderBy: { submittedAt: "desc" },
    include: {
      screenshots: { orderBy: { slot: "asc" } },
      user: { include: { profile: { select: { username: true } } } },
    },
  });

  const budgetSpent = proofs
    .filter(p => p.rewardPaid)
    .reduce((sum, p) => sum + dec(p.rewardAmount), 0);

  const totalBudget = dec(task.totalBudget);

  return {
    ...serializeTask(task, true),
    referenceScreenshotUrls: task.referenceScreenshots.map(s => `/uploads/${s.storageKey}`),
    budgetSpent,
    budgetRemaining: totalBudget - budgetSpent,
    approvedBy:      task.approvedBy      ?? null,
    approvedAt:      task.approvedAt?.toISOString()  ?? null,
    rejectedBy:      task.rejectedBy      ?? null,
    rejectedAt:      task.rejectedAt?.toISOString()  ?? null,
    rejectionReason: task.rejectionReason ?? null,
    proofs: proofs.map(p => ({
      ...serializeProof(p),
      username:       p.user?.profile?.username ?? "",
      screenshotUrls: p.screenshots.map(s => `/uploads/${s.storageKey}`),
    })),
  };
}

export async function adminApproveTask(taskId: string, reviewerId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "pending_review") {
    throw Object.assign(new Error(`Task status is "${task.status}" — only pending_review tasks can be approved`), {
      statusCode: 409, code: "INVALID_STATUS",
    });
  }
  const updated = await db.task.update({
    where: { id: taskId },
    data: { status: "active", approvedBy: reviewerId, approvedAt: new Date() },
  });
  setImmediate(() => createNotification({
    userId:  task.advertiserId,
    type:    "task_approved",
    title:   "Task Approved ✅",
    message: `Your task "${task.title}" has been approved and is now live in the marketplace.`,
    metadata: { taskId },
  }));
  // Phase 21: if a featured request was waiting on this task, move it to pending_featured
  setImmediate(() => handleFeaturedRequestOnTaskApproved(taskId).catch(() => {}));
  return serializeTask(updated);
}

export async function adminRejectTask(taskId: string, reviewerId: string, reason: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "pending_review") {
    throw Object.assign(new Error(`Task status is "${task.status}" — only pending_review tasks can be rejected`), {
      statusCode: 409, code: "INVALID_STATUS",
    });
  }

  const updated = await db.$transaction(async (tx) => {
    await debitWallet(tx, task.advertiserId, "task_vault", task.totalBudget);
    await creditWallet(tx, task.advertiserId, "task", task.totalBudget);
    await writeLedgerEntry(tx, {
      userId: task.advertiserId, type: "transfer", fromWallet: "task_vault", toWallet: "task",
      amount: task.totalBudget, description: "Task rejected — budget refunded",
      referenceId: taskId, referenceType: "task", metadata: { reason, reviewerId },
    });
    return tx.task.update({
      where: { id: taskId },
      data: { status: "rejected", rejectedBy: reviewerId, rejectedAt: new Date(), rejectionReason: reason },
    });
  });

  setImmediate(() => createNotification({
    userId:  task.advertiserId,
    type:    "task_rejected",
    title:   "Task Requires Changes",
    message: `Your task "${task.title}" was not approved. Reason: ${reason}. Your budget has been returned to your task wallet.`,
    metadata: { taskId, reason },
  }));
  // Phase 21: refund any pending featured payment for this task automatically
  setImmediate(() => handleFeaturedRequestOnTaskRejected(taskId, reviewerId).catch(() => {}));
  return serializeTask(updated);
}
