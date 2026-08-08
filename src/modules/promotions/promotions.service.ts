/**
 * Featured Promotion & Platform Announcement Service — Phase 21
 *
 * Promotion types:
 *   "platform"      — Super Admin only, free, platform-wide announcements
 *   "featured_task" — User pays for placement of their approved marketplace task
 *
 * Payment flow (featured_task):
 *   1. User submits task with featured intent → debit task wallet immediately
 *   2. Task pending_review → featured status: pending_marketplace
 *   3. Admin approves task → handleFeaturedRequestOnTaskApproved → pending_featured
 *   4. Super Admin approves featured → approved → Promotion status: active
 *   5. Admin rejects task → handleFeaturedRequestOnTaskRejected → refund + refunded
 *   6. Super Admin rejects featured → adminRejectFeaturedRequest → refund + rejected
 *
 * FeaturedRevenue is a dedicated isolated platform ledger — NOT a user wallet.
 * Only super_admin with admin.promotions.revenue permission may access it.
 */
import { db } from "../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getConfigValue } from "../admin/config/admin.config.service";
import { createNotification } from "../notifications/notifications.service";

export type PromotionLocation = "wallet" | "marketplace" | "referral" | "affiliate" | "ambassador";
export type PromotionStatus   = "draft" | "active" | "scheduled" | "paused" | "expired" | "cancelled";
export type FeaturedStatus    = "pending_marketplace" | "pending_featured" | "approved" | "rejected" | "expired" | "refunded";

const VALID_LOCATIONS: PromotionLocation[] = ["wallet", "marketplace", "referral", "affiliate", "ambassador"];

// ── Internal helpers ──────────────────────────────────────────────────────────

async function recordStatusHistory(
  promotionId: string,
  fromStatus:  string | null,
  toStatus:    string,
  changedBy:   string,
  reason?:     string,
  metadata?:   Record<string, unknown>,
): Promise<void> {
  await db.promotionStatusHistory.create({
    data: {
      promotionId,
      fromStatus: fromStatus ?? null,
      toStatus,
      changedBy,
      reason:   reason   ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

// ── Seed (called at server startup) ──────────────────────────────────────────

export async function seedDefaultFeaturedPricing(): Promise<void> {
  const defaults = [
    { durationDays: 1, price: 3 },
    { durationDays: 2, price: 5 },
    { durationDays: 3, price: 7 },
    { durationDays: 4, price: 9 },
  ];
  for (const row of defaults) {
    await db.featuredPricing.upsert({
      where:  { durationDays: row.durationDays },
      create: { durationDays: row.durationDays, price: row.price, isActive: true },
      update: {},
    });
  }
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export async function getFeaturedPricing() {
  return db.featuredPricing.findMany({ orderBy: { durationDays: "asc" } });
}

export async function updateFeaturedPricing(durationDays: number, price: number, adminId: string) {
  if (durationDays < 1 || durationDays > 4) {
    throw Object.assign(new Error("durationDays must be 1–4"), { statusCode: 400, code: "INVALID_INPUT" });
  }
  if (price <= 0) {
    throw Object.assign(new Error("price must be a positive number"), { statusCode: 400, code: "INVALID_INPUT" });
  }
  return db.featuredPricing.upsert({
    where:  { durationDays },
    create: { durationDays, price, isActive: true, updatedBy: adminId },
    update: { price, updatedBy: adminId },
  });
}

// ── User-facing: active promotion for a location ──────────────────────────────

export async function getActivePromotionForLocation(location: string) {
  const enabled = await getConfigValue<boolean>("feature.featured_promotions", false);
  if (!enabled) return null;

  const placement = await db.promotionPlacement.findFirst({
    where: {
      location,
      isActive:  true,
      promotion: { status: "active" },
    },
    orderBy: { promotion: { priority: "desc" } },
    include: { promotion: true },
  });

  if (!placement) return null;
  const p = placement.promotion;

  return {
    id:          p.id,
    type:        p.type,
    title:       p.title,
    description: p.description,
    ctaLabel:    p.ctaLabel,
    ctaUrl:      p.ctaUrl,
    imageUrl:    p.imageUrl,
    badgeLabel:  p.badgeLabel,
    badgeColor:  p.badgeColor,
    accentColor: p.accentColor,
    startsAt:    p.startsAt?.toISOString() ?? null,
    endsAt:      p.endsAt?.toISOString()   ?? null,
  };
}

// ── User: create featured request for an active task ─────────────────────────

export async function createFeaturedRequest(
  userId: string,
  input:  { taskId: string; durationDays: number; locations: PromotionLocation[]; title: string },
) {
  const { taskId, durationDays, locations, title } = input;

  const enabled = await getConfigValue<boolean>("feature.featured_marketplace_tasks", false);
  if (!enabled) {
    throw Object.assign(new Error("Featured marketplace tasks are not enabled"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }

  if (durationDays < 1 || durationDays > 4) {
    throw Object.assign(new Error("durationDays must be 1–4"), { statusCode: 400 });
  }
  const invalidLocs = locations.filter((l) => !VALID_LOCATIONS.includes(l));
  if (invalidLocs.length > 0) {
    throw Object.assign(new Error(`Invalid locations: ${invalidLocs.join(", ")}`), { statusCode: 400 });
  }

  // Task must belong to user and be active (already approved)
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  if (task.advertiserId !== userId) throw Object.assign(new Error("Not your task"), { statusCode: 403 });
  if (task.status !== "active") {
    throw Object.assign(
      new Error("Task must be active (approved) before requesting featured placement"),
      { statusCode: 409, code: "TASK_NOT_ACTIVE" },
    );
  }

  // Guard: no active featured request already for this task
  const existing = await db.featuredRequest.findFirst({
    where: { taskId, status: { in: ["pending_featured", "approved"] } },
  });
  if (existing) {
    throw Object.assign(new Error("A featured request is already active for this task"), {
      statusCode: 409, code: "DUPLICATE_REQUEST",
    });
  }

  const pricing = await db.featuredPricing.findUnique({ where: { durationDays } });
  if (!pricing || !pricing.isActive) {
    throw Object.assign(new Error("Pricing not available for this duration"), { statusCode: 400 });
  }

  const amount = pricing.price;

  const result = await db.$transaction(async (tx) => {
    // Immediate debit from task wallet — funds move to platform isolated ledger
    await debitWallet(tx, userId, "task", amount);
    await writeLedgerEntry(tx, {
      userId,
      type:          "featured_payment",
      fromWallet:    "task",
      amount,
      description:   `Featured placement payment: ${durationDays} day(s) — task "${title}"`,
      referenceId:   taskId,
      referenceType: "featured_request",
      metadata:      { taskId, durationDays, locations },
    });

    const promotion = await tx.promotion.create({
      data: {
        type:      "featured_task",
        title,
        status:    "draft",
        priority:  0,
        taskId,
        createdBy: userId,
        placements: {
          create: locations.map((loc) => ({ location: loc, isActive: false })),
        },
      },
      include: { placements: true },
    });

    const featuredReq = await tx.featuredRequest.create({
      data: {
        promotionId:  promotion.id,
        userId,
        taskId,
        durationDays,
        amount,
        status: "pending_featured",
      },
    });

    await tx.featuredRevenue.create({
      data: { featuredReqId: featuredReq.id, userId, amount, durationDays },
    });

    await tx.promotionStatusHistory.create({
      data: {
        promotionId: promotion.id,
        fromStatus:  null,
        toStatus:    "draft",
        changedBy:   userId,
        reason:      "Featured request submitted — awaiting super admin approval",
      },
    });

    return { promotion, featuredReq };
  });

  setImmediate(() => createNotification({
    userId,
    type:    "featured_request_submitted",
    title:   "Featured Request Submitted",
    message: `Your featured placement request for "${title}" is pending admin review.`,
    metadata: { taskId, promotionId: result.promotion.id },
  }).catch(() => {}));

  return result;
}

// ── User: list own featured requests ─────────────────────────────────────────

export async function getMyFeaturedRequests(userId: string) {
  const rows = await db.featuredRequest.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    include: {
      promotion: { include: { placements: true } },
    },
  });
  return rows;
}

// ── Task lifecycle hooks (called from admin.tasks.service.ts) ─────────────────

/**
 * Called after adminApproveTask.
 * Moves pending_marketplace → pending_featured so super_admin can approve.
 */
export async function handleFeaturedRequestOnTaskApproved(taskId: string): Promise<void> {
  const req = await db.featuredRequest.findFirst({
    where:   { taskId, status: "pending_marketplace" },
    include: { promotion: true },
  });
  if (!req) return;

  await db.$transaction(async (tx) => {
    await tx.featuredRequest.update({
      where: { id: req.id },
      data:  { status: "pending_featured", updatedAt: new Date() },
    });
    await tx.promotionStatusHistory.create({
      data: {
        promotionId: req.promotionId,
        fromStatus:  req.promotion.status,
        toStatus:    req.promotion.status,
        changedBy:   "system",
        reason:      "Task approved — featured request promoted to pending_featured",
      },
    });
  });

  setImmediate(() => createNotification({
    userId:  req.userId,
    type:    "featured_request_update",
    title:   "Task Approved — Featured Under Review",
    message: "Your task was approved. Your featured placement request is now pending final review.",
    metadata: { taskId, promotionId: req.promotionId },
  }).catch(() => {}));
}

/**
 * Called after adminRejectTask.
 * Refunds featured payment and cancels everything.
 */
export async function handleFeaturedRequestOnTaskRejected(taskId: string, adminId: string): Promise<void> {
  const req = await db.featuredRequest.findFirst({
    where:   { taskId, status: { in: ["pending_marketplace", "pending_featured"] } },
    include: { promotion: true, revenue: true },
  });
  if (!req) return;

  const now = new Date();

  await db.$transaction(async (tx) => {
    await creditWallet(tx, req.userId, "task", req.amount);
    await writeLedgerEntry(tx, {
      userId:        req.userId,
      type:          "featured_refund",
      toWallet:      "task",
      amount:        req.amount,
      description:   `Featured placement refund — task rejected`,
      referenceId:   req.id,
      referenceType: "featured_request",
      metadata:      { taskId, adminId, durationDays: req.durationDays },
    });

    if (req.revenue) {
      await tx.featuredRevenue.update({
        where: { id: req.revenue.id },
        data:  { refunded: true, refundedAt: now, refundedBy: adminId },
      });
    }

    await tx.featuredRequest.update({
      where: { id: req.id },
      data:  { status: "refunded", refundedAt: now, reviewedBy: adminId, reviewedAt: now },
    });

    await tx.promotion.update({
      where: { id: req.promotionId },
      data:  { status: "cancelled" },
    });

    await tx.promotionStatusHistory.create({
      data: {
        promotionId: req.promotionId,
        fromStatus:  req.promotion.status,
        toStatus:    "cancelled",
        changedBy:   adminId,
        reason:      "Task rejected — featured payment refunded automatically",
      },
    });
  });

  setImmediate(() => createNotification({
    userId:  req.userId,
    type:    "featured_refund",
    title:   "Featured Placement Refunded",
    message: `Your task was not approved. Your featured payment of $${req.amount} has been refunded to your task wallet.`,
    metadata: { taskId, amount: req.amount },
  }).catch(() => {}));
}

// ── Admin: list and get promotions ────────────────────────────────────────────

export async function adminListPromotions(opts: { status?: string; type?: string }) {
  const where: any = {};
  if (opts.status) where.status = opts.status;
  if (opts.type)   where.type   = opts.type;
  return db.promotion.findMany({
    where,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    include: { placements: true, featuredRequest: true, schedule: true },
  });
}

export async function adminGetPromotionDetail(id: string) {
  const p = await db.promotion.findUnique({
    where:   { id },
    include: {
      placements:    true,
      schedule:      true,
      featuredRequest: { include: { revenue: true } },
      eventLinks:    true,
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  return p;
}

// ── Admin: create platform promotion ─────────────────────────────────────────

export async function adminCreatePlatformPromotion(
  adminId: string,
  input: {
    title:        string;
    description?: string;
    ctaLabel?:    string;
    ctaUrl?:      string;
    imageUrl?:    string;
    badgeLabel?:  string;
    badgeColor?:  string;
    accentColor?: string;
    priority?:    number;
    locations:    PromotionLocation[];
    startsAt?:    string;
    endsAt?:      string;
  },
) {
  // Draft creation is always allowed — admins must be able to prepare content
  // while the feature flag is disabled. The flag is enforced at activation time.

  return db.$transaction(async (tx) => {
    const p = await tx.promotion.create({
      data: {
        type:        "platform",
        title:       input.title,
        description: input.description ?? null,
        ctaLabel:    input.ctaLabel    ?? null,
        ctaUrl:      input.ctaUrl      ?? null,
        imageUrl:    input.imageUrl    ?? null,
        badgeLabel:  input.badgeLabel  ?? null,
        badgeColor:  input.badgeColor  ?? null,
        accentColor: input.accentColor ?? null,
        priority:    input.priority    ?? 0,
        createdBy:   adminId,
        startsAt:    input.startsAt ? new Date(input.startsAt) : null,
        endsAt:      input.endsAt   ? new Date(input.endsAt)   : null,
        status:      "draft",
        placements: {
          create: input.locations.map((loc) => ({ location: loc, isActive: false })),
        },
      },
      include: { placements: true },
    });
    await tx.promotionStatusHistory.create({
      data: { promotionId: p.id, fromStatus: null, toStatus: "draft", changedBy: adminId },
    });
    return p;
  });
}

// ── Admin: update promotion ───────────────────────────────────────────────────

export async function adminUpdatePromotion(
  id:      string,
  adminId: string,
  input:   Partial<{
    title:       string;
    description: string;
    ctaLabel:    string;
    ctaUrl:      string;
    imageUrl:    string;
    badgeLabel:  string;
    badgeColor:  string;
    accentColor: string;
    priority:    number;
    startsAt:    string;
    endsAt:      string;
  }>,
) {
  const existing = await db.promotion.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  if (["cancelled", "expired"].includes(existing.status)) {
    throw Object.assign(new Error("Cannot update a cancelled or expired promotion"), { statusCode: 409 });
  }

  const data: Record<string, unknown> = {};
  if (input.title       !== undefined) data.title       = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.ctaLabel    !== undefined) data.ctaLabel    = input.ctaLabel;
  if (input.ctaUrl      !== undefined) data.ctaUrl      = input.ctaUrl;
  if (input.imageUrl    !== undefined) data.imageUrl    = input.imageUrl;
  if (input.badgeLabel  !== undefined) data.badgeLabel  = input.badgeLabel;
  if (input.badgeColor  !== undefined) data.badgeColor  = input.badgeColor;
  if (input.accentColor !== undefined) data.accentColor = input.accentColor;
  if (input.priority    !== undefined) data.priority    = input.priority;
  if (input.startsAt    !== undefined) data.startsAt    = new Date(input.startsAt);
  if (input.endsAt      !== undefined) data.endsAt      = new Date(input.endsAt);

  return db.promotion.update({ where: { id }, data, include: { placements: true } });
}

// ── Admin: status transitions ─────────────────────────────────────────────────

export async function adminActivatePromotion(id: string, adminId: string) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });

  // Enforce feature flag at activation — draft creation is always allowed
  if (p.type === "platform") {
    const enabled = await getConfigValue<boolean>("feature.platform_announcements", false);
    if (!enabled) {
      throw Object.assign(new Error("Platform announcements feature flag is disabled — enable it in Feature Flags before activating"), {
        statusCode: 403, code: "FEATURE_DISABLED",
      });
    }
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.promotion.update({ where: { id }, data: { status: "active" } });
    await tx.promotionPlacement.updateMany({ where: { promotionId: id }, data: { isActive: true } });
    await tx.promotionStatusHistory.create({
      data: { promotionId: id, fromStatus: p.status, toStatus: "active", changedBy: adminId },
    });
    return updated;
  });
}

export async function adminPausePromotion(id: string, adminId: string) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  if (!["active", "scheduled"].includes(p.status)) {
    throw Object.assign(new Error(`Cannot pause a "${p.status}" promotion`), { statusCode: 409 });
  }
  const updated = await db.promotion.update({ where: { id }, data: { status: "paused" } });
  await recordStatusHistory(id, p.status, "paused", adminId);
  return updated;
}

export async function adminExpirePromotion(id: string, adminId: string) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  if (["expired", "cancelled"].includes(p.status)) {
    throw Object.assign(new Error(`Promotion is already "${p.status}"`), { statusCode: 409 });
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.promotion.update({ where: { id }, data: { status: "expired" } });
    await tx.promotionPlacement.updateMany({ where: { promotionId: id }, data: { isActive: false } });
    await tx.promotionStatusHistory.create({
      data: { promotionId: id, fromStatus: p.status, toStatus: "expired", changedBy: adminId },
    });
    return updated;
  });
}

export async function adminCancelPromotion(id: string, adminId: string) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  if (["cancelled", "expired"].includes(p.status)) {
    throw Object.assign(new Error(`Promotion is already "${p.status}"`), { statusCode: 409 });
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.promotion.update({ where: { id }, data: { status: "cancelled" } });
    await tx.promotionPlacement.updateMany({ where: { promotionId: id }, data: { isActive: false } });
    await tx.promotionStatusHistory.create({
      data: { promotionId: id, fromStatus: p.status, toStatus: "cancelled", changedBy: adminId },
    });
    return updated;
  });
}

// ── Admin: placements ─────────────────────────────────────────────────────────

export async function adminSetPromotionPlacements(id: string, locations: PromotionLocation[]) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });

  return db.$transaction(async (tx) => {
    await tx.promotionPlacement.deleteMany({ where: { promotionId: id } });
    const isActive = p.status === "active";
    if (locations.length > 0) {
      await tx.promotionPlacement.createMany({
        data: locations.map((loc) => ({ promotionId: id, location: loc, isActive })),
      });
    }
    return tx.promotionPlacement.findMany({ where: { promotionId: id } });
  });
}

// ── Admin: schedule ───────────────────────────────────────────────────────────

export async function adminSetPromotionSchedule(
  id:      string,
  adminId: string,
  input:   { startsAt: string; endsAt: string; timeZone?: string; autoActivate?: boolean; autoExpire?: boolean },
) {
  const p = await db.promotion.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });

  const schedule = await db.promotionSchedule.upsert({
    where:  { promotionId: id },
    create: {
      promotionId:  id,
      startsAt:     new Date(input.startsAt),
      endsAt:       new Date(input.endsAt),
      timeZone:     input.timeZone     ?? "UTC",
      autoActivate: input.autoActivate ?? true,
      autoExpire:   input.autoExpire   ?? true,
    },
    update: {
      startsAt:     new Date(input.startsAt),
      endsAt:       new Date(input.endsAt),
      timeZone:     input.timeZone     ?? "UTC",
      autoActivate: input.autoActivate ?? true,
      autoExpire:   input.autoExpire   ?? true,
    },
  });

  if (p.status === "draft") {
    await db.promotion.update({ where: { id }, data: { status: "scheduled" } });
    await recordStatusHistory(id, p.status, "scheduled", adminId, "Scheduled via admin");
  }

  return schedule;
}

// ── Admin: event links ────────────────────────────────────────────────────────

export async function adminAddEventLink(
  promotionId: string,
  adminId:     string,
  input:       { eventType: string; eventId?: string; metadata?: Record<string, unknown> },
) {
  const p = await db.promotion.findUnique({ where: { id: promotionId } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });

  return db.promotionEventLink.create({
    data: {
      promotionId,
      eventType: input.eventType,
      eventId:   input.eventId  ?? null,
      metadata:  input.metadata ? JSON.stringify(input.metadata) : null,
      createdBy: adminId,
    },
  });
}

export async function adminRemoveEventLink(linkId: string) {
  const link = await db.promotionEventLink.findUnique({ where: { id: linkId } });
  if (!link) throw Object.assign(new Error("Event link not found"), { statusCode: 404 });
  await db.promotionEventLink.delete({ where: { id: linkId } });
}

// ── Admin: featured request management ───────────────────────────────────────

export async function adminListFeaturedRequests(opts: { status?: string }) {
  return db.featuredRequest.findMany({
    where:   opts.status ? { status: opts.status } : {},
    orderBy: { createdAt: "desc" },
    include: {
      promotion: { include: { placements: true } },
      user:      { include: { profile: { select: { username: true } } } },
      revenue:   true,
    },
  });
}

export async function adminApproveFeaturedRequest(reqId: string, adminId: string) {
  const req = await db.featuredRequest.findUnique({
    where:   { id: reqId },
    include: { promotion: true },
  });
  if (!req) throw Object.assign(new Error("Featured request not found"), { statusCode: 404 });
  if (req.status !== "pending_featured") {
    throw Object.assign(new Error(`Cannot approve — status is "${req.status}"`), { statusCode: 409 });
  }

  const now    = new Date();
  const endsAt = new Date(now.getTime() + req.durationDays * 24 * 60 * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.featuredRequest.update({
      where: { id: reqId },
      data:  { status: "approved", reviewedBy: adminId, reviewedAt: now },
    });
    await tx.promotion.update({
      where: { id: req.promotionId },
      data:  { status: "active", startsAt: now, endsAt },
    });
    await tx.promotionPlacement.updateMany({
      where: { promotionId: req.promotionId },
      data:  { isActive: true },
    });
    await tx.promotionStatusHistory.create({
      data: {
        promotionId: req.promotionId,
        fromStatus:  "draft",
        toStatus:    "active",
        changedBy:   adminId,
        reason:      "Featured request approved",
        metadata:    JSON.stringify({ durationDays: req.durationDays, endsAt: endsAt.toISOString() }),
      },
    });
  });

  setImmediate(() => createNotification({
    userId:  req.userId,
    type:    "featured_approved",
    title:   "Featured Placement Approved! 🎉",
    message: `Your featured placement is now live for ${req.durationDays} day(s)!`,
    metadata: { promotionId: req.promotionId, durationDays: req.durationDays },
  }).catch(() => {}));
}

export async function adminRejectFeaturedRequest(reqId: string, adminId: string, reason: string) {
  const req = await db.featuredRequest.findUnique({
    where:   { id: reqId },
    include: { promotion: true, revenue: true },
  });
  if (!req) throw Object.assign(new Error("Featured request not found"), { statusCode: 404 });
  if (!["pending_featured", "pending_marketplace"].includes(req.status)) {
    throw Object.assign(new Error(`Cannot reject — status is "${req.status}"`), { statusCode: 409 });
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    await creditWallet(tx, req.userId, "task", req.amount);
    await writeLedgerEntry(tx, {
      userId:        req.userId,
      type:          "featured_refund",
      toWallet:      "task",
      amount:        req.amount,
      description:   `Featured placement refund — rejected by admin`,
      referenceId:   req.id,
      referenceType: "featured_request",
      metadata:      { reason, adminId },
    });

    if (req.revenue) {
      await tx.featuredRevenue.update({
        where: { id: req.revenue.id },
        data:  { refunded: true, refundedAt: now, refundedBy: adminId },
      });
    }

    await tx.featuredRequest.update({
      where: { id: reqId },
      data:  { status: "rejected", reviewedBy: adminId, reviewedAt: now, rejectionReason: reason },
    });

    await tx.promotion.update({ where: { id: req.promotionId }, data: { status: "cancelled" } });

    await tx.promotionStatusHistory.create({
      data: {
        promotionId: req.promotionId,
        fromStatus:  req.promotion.status,
        toStatus:    "cancelled",
        changedBy:   adminId,
        reason:      `Featured request rejected: ${reason}`,
      },
    });
  });

  setImmediate(() => createNotification({
    userId:  req.userId,
    type:    "featured_rejected",
    title:   "Featured Request Not Approved",
    message: `Your featured placement request was not approved. Reason: ${reason}. Your payment of $${req.amount} has been refunded to your task wallet.`,
    metadata: { amount: req.amount, reason },
  }).catch(() => {}));
}

// ── Admin: revenue (isolated platform ledger) ─────────────────────────────────

export async function adminGetFeaturedRevenue() {
  const [grossAgg, refundAgg, entries] = await Promise.all([
    db.featuredRevenue.aggregate({ _sum: { amount: true }, where: { refunded: false } }),
    db.featuredRevenue.aggregate({ _sum: { amount: true }, where: { refunded: true } }),
    db.featuredRevenue.findMany({
      orderBy: { createdAt: "desc" },
      take:    200,
      include: {
        featuredRequest: {
          include: {
            promotion: { select: { title: true } },
            user:      { include: { profile: { select: { username: true } } } },
          },
        },
      },
    }),
  ]);

  const totalGross   = grossAgg._sum.amount   ?? 0;
  const totalRefunds = refundAgg._sum.amount   ?? 0;

  return {
    totalGross:   parseFloat(totalGross.toFixed(2)),
    totalRefunds: parseFloat(totalRefunds.toFixed(2)),
    netRevenue:   parseFloat((totalGross - totalRefunds).toFixed(2)),
    entries,
  };
}

// ── Admin: status history ─────────────────────────────────────────────────────

export async function adminGetStatusHistory(promotionId: string) {
  const p = await db.promotion.findUnique({ where: { id: promotionId } });
  if (!p) throw Object.assign(new Error("Promotion not found"), { statusCode: 404 });
  return db.promotionStatusHistory.findMany({
    where:   { promotionId },
    orderBy: { createdAt: "desc" },
  });
}

// ── Scheduling automation ─────────────────────────────────────────────────────
// Called by setInterval in index.ts every 60 seconds.
// Processes PromotionSchedule records with autoActivate/autoExpire flags.

export async function runScheduledPromotions(): Promise<void> {
  const now = new Date();
  const SYSTEM_ACTOR = "system-scheduler";

  // Auto-activate: scheduled promotions whose startsAt has passed
  const toActivate = await db.promotionSchedule.findMany({
    where: {
      autoActivate: true,
      startsAt:     { lte: now },
      promotion:    { status: "scheduled" },
    },
    include: { promotion: true },
  });

  for (const schedule of toActivate) {
    try {
      await db.$transaction(async (tx) => {
        await tx.promotion.update({
          where: { id: schedule.promotionId },
          data:  { status: "active" },
        });
        await tx.promotionPlacement.updateMany({
          where: { promotionId: schedule.promotionId },
          data:  { isActive: true },
        });
        await tx.promotionStatusHistory.create({
          data: {
            promotionId: schedule.promotionId,
            fromStatus:  "scheduled",
            toStatus:    "active",
            changedBy:   SYSTEM_ACTOR,
            reason:      "Auto-activated by scheduler",
          },
        });
      });
    } catch {
      // Non-fatal — log silently, try again next tick
    }
  }

  // Auto-expire: active/scheduled promotions whose endsAt has passed
  const toExpire = await db.promotionSchedule.findMany({
    where: {
      autoExpire: true,
      endsAt:     { lte: now },
      promotion:  { status: { in: ["active", "scheduled"] } },
    },
    include: { promotion: true },
  });

  for (const schedule of toExpire) {
    try {
      await db.$transaction(async (tx) => {
        await tx.promotion.update({
          where: { id: schedule.promotionId },
          data:  { status: "expired" },
        });
        await tx.promotionPlacement.updateMany({
          where: { promotionId: schedule.promotionId },
          data:  { isActive: false },
        });
        await tx.promotionStatusHistory.create({
          data: {
            promotionId: schedule.promotionId,
            fromStatus:  schedule.promotion.status,
            toStatus:    "expired",
            changedBy:   SYSTEM_ACTOR,
            reason:      "Auto-expired by scheduler",
          },
        });
      });
    } catch {
      // Non-fatal
    }
  }

  // Also expire featured_task promotions whose endsAt has passed (no schedule record needed)
  const expiredFeatured = await db.promotion.findMany({
    where: {
      type:   "featured_task",
      status: "active",
      endsAt: { lte: now },
    },
  });

  for (const promo of expiredFeatured) {
    try {
      await db.$transaction(async (tx) => {
        await tx.promotion.update({ where: { id: promo.id }, data: { status: "expired" } });
        await tx.promotionPlacement.updateMany({ where: { promotionId: promo.id }, data: { isActive: false } });
        await tx.featuredRequest.updateMany({
          where: { promotionId: promo.id, status: "approved" },
          data:  { status: "expired" },
        });
        await tx.promotionStatusHistory.create({
          data: {
            promotionId: promo.id,
            fromStatus:  "active",
            toStatus:    "expired",
            changedBy:   SYSTEM_ACTOR,
            reason:      "Auto-expired by scheduler (endsAt passed)",
          },
        });
      });
    } catch {
      // Non-fatal
    }
  }
}
