import { db } from "../../db";
import { storeDocument } from "../kyc/storage";
import { resolveUserTier } from "../withdrawals/limits";
import { debitWallet, creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getConfigValue } from "../admin/config/admin.config.service";

const DEFAULT_REWARD_SPLIT: Record<string, number> = { free: 0.35, verified: 0.45, vip: 0.65 };

export async function getTaskRewardSplit(tier: string): Promise<number> {
  const fallback = DEFAULT_REWARD_SPLIT[tier] ?? 0.35;
  const raw = await getConfigValue<number>(`task.reward_split.${tier}`, fallback);
  if (typeof raw !== "number" || raw <= 0 || raw > 1) return fallback;
  return raw;
}

function parseJson(raw: string | null | undefined, fallback: any = []): any {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function serializeTask(t: any, includeRef = false) {
  return {
    id: t.id, advertiserId: t.advertiserId, advertiserName: t.advertiserName,
    title: t.title, description: t.description ?? null, type: t.type, status: t.status,
    totalBudget: t.totalBudget, totalReward: t.totalReward, rewardPerSlot: t.rewardPerSlot,
    totalSlots: t.totalSlots, completedSlots: t.completedSlots, link: t.link ?? null,
    campaignImageUrl: t.campaignImageUrl ?? null, requirements: parseJson(t.requirements, []),
    proofType: t.proofType ?? null, proofInstructions: t.proofInstructions ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ...(includeRef && t.referenceScreenshots && {
      referenceScreenshots: t.referenceScreenshots.map((s: any) => ({ id: s.id, slot: s.slot, url: `/uploads/${s.storageKey}` })),
    }),
  };
}

export async function createTask(advertiserId: string, input: any) {
  const marketplaceEnabled = await getConfigValue<boolean>("feature.task_marketplace", true);
  if (!marketplaceEnabled) throw Object.assign(new Error("Task marketplace is currently disabled"), { statusCode: 403, code: "FEATURE_DISABLED" });

  const [profile, kyc, sub] = await Promise.all([
    db.userProfile.findUnique({ where: { userId: advertiserId } }),
    db.kycSubmission.findUnique({ where: { userId: advertiserId } }),
    db.subscription.findUnique({ where: { userId: advertiserId } }),
  ]);
  if (!profile) throw Object.assign(new Error("User profile not found"), { statusCode: 404 });
  if (!profile.phoneVerified) throw Object.assign(new Error("Verified phone is required to create tasks"), { statusCode: 403, code: "PHONE_REQUIRED" });
  if (kyc?.status !== "verified") throw Object.assign(new Error("Verified KYC is required to create tasks"), { statusCode: 403, code: "KYC_REQUIRED" });
  const isVIP = !!(sub?.isActive && sub.endsAt > new Date());
  if (!isVIP) throw Object.assign(new Error("VIP membership required to create tasks"), { statusCode: 403, code: "VIP_REQUIRED" });

  const refKeys: Array<{ key: string; slot: number }> = [];
  for (let i = 0; i < (input.referenceScreenshots ?? []).length; i++) {
    const dataUrl = input.referenceScreenshots[i];
    const stored = await storeDocument(dataUrl, `tasks/ref/${advertiserId}`);
    refKeys.push({ key: stored.key, slot: i });
  }
  const totalReward = input.rewardPerSlot * input.totalSlots;

  const task = await db.$transaction(async (tx) => {
    await debitWallet(tx, advertiserId, "task", input.totalBudget);
    await creditWallet(tx, advertiserId, "task_vault", input.totalBudget);
    const t = await tx.task.create({ data: {
      advertiserId, advertiserName: profile.username, title: input.title, description: input.description,
      type: input.type, totalBudget: input.totalBudget, totalReward, rewardPerSlot: input.rewardPerSlot,
      totalSlots: input.totalSlots, link: input.link, campaignImageUrl: input.campaignImageUrl,
      requirements: JSON.stringify(input.requirements ?? []), proofType: input.proofType,
      proofInstructions: input.proofInstructions, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    } });
    if (refKeys.length > 0) await tx.taskReferenceScreenshot.createMany({ data: refKeys.map(r => ({ taskId: t.id, storageKey: r.key, slot: r.slot })) });
    await writeLedgerEntry(tx, {
      userId: advertiserId, type: "transfer", fromWallet: "task", toWallet: "task_vault", amount: input.totalBudget,
      description: "Task created — budget escrowed", referenceId: t.id, referenceType: "task",
    });
    return t;
  });
  return serializeTask(task);
}

export async function listTasks(opts: { cursor?: string; limit: number; type?: string; status?: string }) {
  const marketplaceEnabled = await getConfigValue<boolean>("feature.task_marketplace", true);
  if (!marketplaceEnabled) throw Object.assign(new Error("Task marketplace is currently disabled"), { statusCode: 403, code: "FEATURE_DISABLED" });
  const { cursor, limit, type, status = "active" } = opts;
  const where: any = { status };
  if (type) where.type = type;
  if (cursor) {
    const anchor = await db.task.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }
  const rows = await db.task.findMany({ where, orderBy: { createdAt: "desc" }, take: limit + 1 });
  const available = status === "active" ? rows.filter(t => t.completedSlots < t.totalSlots && (!t.expiresAt || t.expiresAt > new Date())) : rows;
  const hasMore = rows.length > limit || available.length > limit;
  const items = available.slice(0, limit);
  return { items: items.map(t => serializeTask(t)), nextCursor: hasMore && items.length ? items[items.length - 1].id : null, hasMore };
}

export async function getTask(taskId: string) {
  const t = await db.task.findUnique({ where: { id: taskId }, include: { referenceScreenshots: { orderBy: { slot: "asc" } } } });
  if (!t) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeTask(t, true);
}

export async function getMyTasks(advertiserId: string, status?: string) {
  const where: any = { advertiserId };
  if (status) where.status = status;
  const rows = await db.task.findMany({ where, orderBy: { createdAt: "desc" } });
  return rows.map(t => serializeTask(t));
}

export async function updateTask(advertiserId: string, taskId: string, input: any) {
  const task = await db.task.findFirst({ where: { id: taskId, advertiserId } });
  if (!task) throw Object.assign(new Error("Task not found or not owned by you"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status === "completed" || task.status === "rejected") throw Object.assign(new Error(`Cannot edit a ${task.status} task`), { statusCode: 400, code: "INVALID_STATUS" });
  const updated = await db.task.update({ where: { id: taskId }, data: {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.link !== undefined && { link: input.link }),
    ...(input.proofInstructions !== undefined && { proofInstructions: input.proofInstructions }),
    status: "pending_review", approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
  } });
  return serializeTask(updated);
}

export async function updateTaskStatus(advertiserId: string, taskId: string, status: "active" | "paused") {
  const task = await db.task.findFirst({ where: { id: taskId, advertiserId } });
  if (!task) throw Object.assign(new Error("Task not found or not owned by you"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "active" && task.status !== "paused") throw Object.assign(new Error(`Only active or paused tasks can change lifecycle state — current status: ${task.status}`), { statusCode: 409, code: "INVALID_STATUS" });
  const updated = await db.task.update({ where: { id: taskId }, data: { status } });
  return serializeTask(updated);
}

export async function deleteTask(advertiserId: string, taskId: string) {
  const task = await db.task.findFirst({ where: { id: taskId, advertiserId } });
  if (!task) throw Object.assign(new Error("Task not found or not owned by you"), { statusCode: 404, code: "NOT_FOUND" });
  if (task.status !== "pending_review") throw Object.assign(new Error(`Only pending tasks can be deleted — current status: ${task.status}`), { statusCode: 400, code: "INVALID_STATUS" });
  await db.$transaction(async (tx) => {
    await debitWallet(tx, advertiserId, "task_vault", task.totalBudget);
    await creditWallet(tx, advertiserId, "task", task.totalBudget);
    await writeLedgerEntry(tx, { userId: advertiserId, type: "transfer", fromWallet: "task_vault", toWallet: "task", amount: task.totalBudget, description: "Task deleted — budget refunded", referenceId: taskId, referenceType: "task" });
    await tx.task.delete({ where: { id: taskId } });
  });
}

export { serializeTask, parseJson };
