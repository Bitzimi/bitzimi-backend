/**
 * Affiliate Application Service
 *
 * Manages the lifecycle of affiliate program applications:
 *   pending  — submitted, awaiting admin review
 *   approved — admin approved; user can access the AffiliateProgram page
 *   rejected — admin rejected with a reason; user may re-apply
 *
 * Business rules:
 *   • One application per user (userId is unique on the model).
 *   • A rejected applicant may re-apply (upsert resets status to pending).
 *   • An approved applicant cannot re-apply while approved.
 *   • Minimum 1,000 members required (self-reported; admin verifies via screenshot).
 *   • Verification is MANUAL — admin checks the submitted screenshot and link.
 *   • Admin approve/reject functions are wired to admin routes (Phase 7 Prompt 2+).
 */
import { db } from "../../db";
import { createNotification } from "../notifications/notifications.service";
import { storeDocument } from "../kyc/storage";

const VALID_PLATFORMS = ["facebook", "x", "telegram", "whatsapp", "instagram", "youtube", "tiktok", "discord"] as const;
type SocialPlatform = typeof VALID_PLATFORMS[number];

function serialize(app: any) {
  return {
    id:              app.id,
    status:          app.status as "pending" | "approved" | "rejected",
    fullName:        app.fullName,
    socialPlatform:  app.socialPlatform as SocialPlatform,
    socialLink:      app.socialLink,
    socialUsername:  app.socialUsername,
    totalMembers:    app.totalMembers,
    screenshotUrl:   app.screenshotKey ? `/uploads/${app.screenshotKey}` : null,
    rejectionReason: app.rejectionReason ?? null,
    submittedAt:     app.submittedAt.toISOString(),
    reviewedAt:      app.reviewedAt?.toISOString() ?? null,
  };
}

// ── Submit / re-apply ─────────────────────────────────────────────────────────

export async function submitAffiliateApplication(userId: string, input: {
  fullName:           string;
  socialPlatform:     string;
  socialLink:         string;
  socialUsername:     string;
  totalMembers:       number;
  screenshotDataUrl?: string;   // base64 data URL — proof of ownership / admin access
}): Promise<ReturnType<typeof serialize>> {
  // Block re-application if currently approved
  const existing = await db.affiliateApplication.findUnique({ where: { userId } });
  if (existing?.status === "approved") {
    throw Object.assign(
      new Error("Your affiliate application is already approved"),
      { statusCode: 409, code: "ALREADY_APPROVED" }
    );
  }

  // Validate platform (belt-and-suspenders — route schema already validates)
  if (!VALID_PLATFORMS.includes(input.socialPlatform as SocialPlatform)) {
    throw Object.assign(
      new Error(`Invalid social platform: ${input.socialPlatform}`),
      { statusCode: 400, code: "INVALID_PLATFORM" }
    );
  }

  // Validate minimum members (self-reported; admin verifies via screenshot)
  if (input.totalMembers < 1000) {
    throw Object.assign(
      new Error("Minimum 1,000 members required to apply for the affiliate program"),
      { statusCode: 400, code: "INSUFFICIENT_MEMBERS" }
    );
  }

  // Store ownership screenshot if provided
  let screenshotKey: string | null = null;
  if (input.screenshotDataUrl?.startsWith("data:")) {
    const stored = await storeDocument(input.screenshotDataUrl, `affiliates/screenshots/${userId}`);
    screenshotKey = stored.key;
  }

  const app = await db.affiliateApplication.upsert({
    where:  { userId },
    create: {
      userId,
      fullName:       input.fullName.trim(),
      socialPlatform: input.socialPlatform,
      socialLink:     input.socialLink.trim(),
      socialUsername: input.socialUsername.trim(),
      totalMembers:   input.totalMembers,
      screenshotKey:  screenshotKey ?? undefined,
      status:         "pending",
    },
    update: {
      // Allow re-application after rejection — reset all fields to pending
      fullName:        input.fullName.trim(),
      socialPlatform:  input.socialPlatform,
      socialLink:      input.socialLink.trim(),
      socialUsername:  input.socialUsername.trim(),
      totalMembers:    input.totalMembers,
      screenshotKey:   screenshotKey ?? undefined,
      status:          "pending",
      reviewedBy:      null,
      reviewedAt:      null,
      rejectionReason: null,
      submittedAt:     new Date(),
    },
  });

  setImmediate(() => createNotification({
    userId,
    type:    "affiliate_application_submitted",
    title:   "Application Submitted",
    message: "Your affiliate program application has been submitted and is under review. We will notify you within 24–48 hours.",
    metadata: { applicationId: app.id },
  }));

  return serialize(app);
}

// ── Get application status (for the applying user) ────────────────────────────

export async function getAffiliateApplication(userId: string) {
  const app = await db.affiliateApplication.findUnique({ where: { userId } });
  return app ? serialize(app) : null;
}

// ── Admin: approve application ────────────────────────────────────────────────
// Called by admin routes (Phase 7 Admin Panel — not yet built).

export async function approveAffiliateApplication(applicationId: string, adminId: string) {
  const app = await db.affiliateApplication.findUnique({ where: { id: applicationId } });
  if (!app) throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (app.status === "approved") throw Object.assign(new Error("Already approved"), { statusCode: 409, code: "ALREADY_APPROVED" });

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.affiliateApplication.update({
      where: { id: applicationId },
      data:  { status: "approved", reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: null },
    });
    // Upgrade programLevel from "referral" → "affiliate".
    // Only upgrades — never downgrades an existing Ambassador.
    await tx.user.updateMany({
      where: { id: app.userId, programLevel: "referral" },
      data:  { programLevel: "affiliate" },
    });
    return result;
  });

  setImmediate(() => createNotification({
    userId:  app.userId,
    type:    "affiliate_application_approved",
    title:   "Affiliate Application Approved",
    message: "Congratulations! Your affiliate application has been approved. You can now access the Affiliate Program and start earning commissions.",
    metadata: { applicationId },
  }));

  return serialize(updated);
}

// ── Admin: reject application ─────────────────────────────────────────────────
// Called by admin routes (Phase 7 Admin Panel — not yet built).

export async function rejectAffiliateApplication(applicationId: string, adminId: string, reason: string) {
  const app = await db.affiliateApplication.findUnique({ where: { id: applicationId } });
  if (!app) throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (app.status === "approved") throw Object.assign(new Error("Cannot reject an approved application"), { statusCode: 409, code: "ALREADY_APPROVED" });

  const updated = await db.affiliateApplication.update({
    where: { id: applicationId },
    data:  { status: "rejected", reviewedBy: adminId, reviewedAt: new Date(), rejectionReason: reason },
  });

  setImmediate(() => createNotification({
    userId:  app.userId,
    type:    "affiliate_application_rejected",
    title:   "Affiliate Application Not Approved",
    message: `Your affiliate application was reviewed and not approved. Reason: ${reason}. You may reapply after addressing the feedback.`,
    metadata: { applicationId, reason },
  }));

  return serialize(updated);
}

// ── Admin: list applications ──────────────────────────────────────────────────
// Called by admin routes (Phase 7 Admin Panel — not yet built).

export async function listAffiliateApplications(opts: {
  status?: "pending" | "approved" | "rejected";
  cursor?: string;
  limit?:  number;
}) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) {
    const anchor = await db.affiliateApplication.findUnique({ where: { id: cursor } });
    if (anchor) where.submittedAt = { lt: anchor.submittedAt };
  }

  const rows = await db.affiliateApplication.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take:    limit + 1,
    include: { user: { include: { profile: { select: { username: true } } } } },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(r => ({
      ...serialize(r),
      userId:   r.userId,
      username: r.user.profile?.username ?? "",
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}
