import { db } from "../../../db";
import { getDocumentUrl } from "../../kyc/storage";
import { serializeSubmission } from "../../kyc/kyc.service";
import { createNotification } from "../../notifications/notifications.service";

// ── Review queue ──────────────────────────────────────────────────────────────

export async function getKycQueue(statusFilter?: string) {
  const statuses = statusFilter
    ? [statusFilter]
    : ["pending", "under_review"];   // default: everything needing a decision

  const submissions = await db.kycSubmission.findMany({
    where:   { status: { in: statuses } },
    include: { user: { include: { profile: true } } },
    orderBy: { submittedAt: "asc" },  // oldest first
  });

  return submissions.map(s => ({
    ...serializeSubmission(s),
    userId:     s.userId,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    reviewedBy: s.reviewedBy ?? null,
    user: {
      id:       s.user.id,
      email:    s.user.email,
      username: s.user.profile?.username ?? "",
    },
  }));
}

// ── Submission detail (with signed document URLs) ─────────────────────────────

export async function getKycSubmissionDetail(submissionId: string) {
  const s = await db.kycSubmission.findUnique({
    where:   { id: submissionId },
    include: { user: { include: { profile: true } } },
  });
  if (!s) throw Object.assign(new Error("KYC submission not found"), { statusCode: 404, code: "NOT_FOUND" });

  const [frontUrl, backUrl, selfieUrl, poaUrl] = await Promise.all([
    getDocumentUrl(s.frontDocKey),
    getDocumentUrl(s.backDocKey),
    getDocumentUrl(s.selfieKey),
    getDocumentUrl(s.poaKey),
  ]);

  return {
    ...serializeSubmission(s),
    userId:     s.userId,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    reviewedBy: s.reviewedBy ?? null,
    user: { id: s.user.id, email: s.user.email, username: s.user.profile?.username ?? "" },
    // Presigned document URLs (1h TTL in production, local paths in dev)
    documentUrls: { front: frontUrl, back: backUrl, selfie: selfieUrl, poa: poaUrl },
  };
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveKyc(submissionId: string, reviewerId: string) {
  const s = await db.kycSubmission.findUnique({ where: { id: submissionId } });
  if (!s) throw Object.assign(new Error("KYC submission not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (s.status === "verified") throw Object.assign(new Error("Already verified"), { statusCode: 409, code: "ALREADY_VERIFIED" });

  const updated = await db.kycSubmission.update({
    where: { id: submissionId },
    data: {
      status:     "verified",
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    },
  });

  // Sync verified name to user profile
  if (s.fullName) {
    await db.userProfile.update({
      where: { userId: s.userId },
      data:  { fullName: s.fullName },
    }).catch(() => {});
  }

  setImmediate(() => createNotification({
    userId:  s.userId,
    type:    "verification_approved",
    title:   "Identity Verified ✅",
    message: "Your identity has been successfully verified. You now have access to higher withdrawal limits and verified member benefits.",
    metadata: { countryCode: s.countryCode, idType: s.idType },
  }));

  return serializeSubmission(updated);
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectKyc(submissionId: string, reviewerId: string, reason: string) {
  const s = await db.kycSubmission.findUnique({ where: { id: submissionId } });
  if (!s) throw Object.assign(new Error("KYC submission not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (s.status === "verified") throw Object.assign(new Error("Cannot reject a verified submission"), { statusCode: 409, code: "ALREADY_VERIFIED" });

  const updated = await db.kycSubmission.update({
    where: { id: submissionId },
    data: {
      status:          "rejected",
      reviewedBy:      reviewerId,
      reviewedAt:      new Date(),
      rejectionReason: reason,
    },
  });

  // Reset to unverified so user can resubmit
  // The user's identity is still "unverified" — no downgrade needed

  setImmediate(() => createNotification({
    userId:  s.userId,
    type:    "verification_rejected",
    title:   "Verification Update Required",
    message: `Your identity verification was not approved. Reason: ${reason}. Please resubmit with correct documents.`,
    metadata: { reason },
  }));

  return serializeSubmission(updated);
}
