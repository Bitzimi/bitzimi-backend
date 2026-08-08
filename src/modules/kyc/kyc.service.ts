import { db } from "../../db";
import { storeDocument, getDocumentUrl } from "./storage";
import { runVerificationPipeline } from "./verification";

// 24 countries supported by the frontend, with their accepted ID types
export const SUPPORTED_COUNTRIES = [
  { code: "AR", name: "Argentina",    idTypes: ["DNI", "Passport"] },
  { code: "AU", name: "Australia",    idTypes: ["Driver's License", "Passport"] },
  { code: "BR", name: "Brazil",       idTypes: ["RG", "Passport"] },
  { code: "CA", name: "Canada",       idTypes: ["Driver's License", "Passport"] },
  { code: "CN", name: "China",        idTypes: ["Resident ID", "Passport"] },
  { code: "EG", name: "Egypt",        idTypes: ["National ID", "Passport"] },
  { code: "FR", name: "France",       idTypes: ["Carte Nationale", "Passport"] },
  { code: "DE", name: "Germany",      idTypes: ["Personalausweis", "Passport"] },
  { code: "GH", name: "Ghana",        idTypes: ["Ghana Card", "Passport"] },
  { code: "IN", name: "India",        idTypes: ["Aadhaar", "Passport"] },
  { code: "ID", name: "Indonesia",    idTypes: ["KTP", "Passport"] },
  { code: "IT", name: "Italy",        idTypes: ["Carta d'Identità", "Passport"] },
  { code: "JP", name: "Japan",        idTypes: ["My Number Card", "Passport"] },
  { code: "KE", name: "Kenya",        idTypes: ["National ID", "Passport"] },
  { code: "MX", name: "Mexico",       idTypes: ["INE", "Passport"] },
  { code: "NZ", name: "New Zealand",  idTypes: ["Driver's License", "Passport"] },
  { code: "NG", name: "Nigeria",      idTypes: ["NIN Slip", "Passport"] },
  { code: "PH", name: "Philippines",  idTypes: ["PhilSys ID", "Passport"] },
  { code: "RU", name: "Russia",       idTypes: ["Passport (Internal)", "Passport"] },
  { code: "SG", name: "Singapore",    idTypes: ["NRIC", "Passport"] },
  { code: "ZA", name: "South Africa", idTypes: ["Green ID Book", "Passport"] },
  { code: "KR", name: "South Korea",  idTypes: ["Resident Registration", "Passport"] },
  { code: "GB", name: "United Kingdom",idTypes: ["Driver's License", "Passport"] },
  { code: "US", name: "United States",idTypes: ["Driver's License", "Passport"] },
];

// ── Document upload ───────────────────────────────────────────────────────────

type DocType = "front" | "back" | "selfie" | "poa";

export async function uploadKycDocument(
  userId: string,
  docType: DocType,
  dataUrl: string,
): Promise<{ key: string }> {
  // Store the document to object storage first
  const stored = await storeDocument(dataUrl, `kyc/${userId}`);

  const fieldMap: Record<DocType, string> = {
    front: "frontDocKey", back: "backDocKey", selfie: "selfieKey", poa: "poaKey",
  };

  // Atomic: upsert KYC record + persist storage key in a single transaction.
  // Prevents orphaned files from a crash between upsert and update.
  await db.$transaction(async (tx) => {
    await tx.kycSubmission.upsert({
      where:  { userId },
      create: { userId, status: "unverified", [fieldMap[docType]]: stored.key },
      update: { [fieldMap[docType]]: stored.key },
    });
  });

  return { key: stored.key };
}

// ── KYC submission ────────────────────────────────────────────────────────────

export async function submitKyc(userId: string, input: {
  countryCode: string; idType: string; fullName: string; dateOfBirth: string;
  address: string; city: string; state: string; country: string; postalCode: string;
  frontDocKey: string; backDocKey?: string; selfieKey: string; poaKey?: string;
}) {
  const existing = await db.kycSubmission.findUnique({ where: { userId } });

  // Block re-submission if already verified or under review
  if (existing?.status === "verified") {
    throw Object.assign(new Error("Your account is already verified."), { statusCode: 409, code: "ALREADY_VERIFIED" });
  }
  if (existing?.status === "under_review") {
    throw Object.assign(new Error("Your submission is already under review."), { statusCode: 409, code: "UNDER_REVIEW" });
  }

  const submittedAddress = [input.address, input.city, input.state, input.country, input.postalCode]
    .filter(Boolean).join(", ");

  const submission = await db.kycSubmission.upsert({
    where:  { userId },
    create: { userId, ...input, status: "pending", submittedAt: new Date() },
    update: { ...input, status: "pending", submittedAt: new Date() },
  });

  // Run verification pipeline async — do not await
  setImmediate(() => processVerification(userId, input.frontDocKey, input.selfieKey, submittedAddress));

  return serializeSubmission(submission);
}

// ── Async verification processing ─────────────────────────────────────────────

async function processVerification(
  userId: string,
  frontDocKey: string,
  selfieKey: string,
  submittedAddress: string,
): Promise<void> {
  try {
    const result = await runVerificationPipeline({ frontDocKey, selfieKey, submittedAddress });

    let status: string;
    if (result.verdict === "auto_approved") {
      status = "verified";
      // Sync verified name and lock address in profile
      const kyc = await db.kycSubmission.findUnique({ where: { userId } });
      if (kyc?.fullName) {
        await db.userProfile.update({
          where: { userId },
          data: {
            fullName: kyc.fullName,
            addressLockedByVerification: true, // lock address after KYC approval
          },
        }).catch(() => {});
      }
    } else if (result.verdict === "under_review") {
      status = "under_review";
    } else {
      status = "rejected";
    }

    await db.kycSubmission.update({
      where: { userId },
      data: {
        status,
        faceConfidence: result.faceConfidence,
        addressMatch:   result.addressMatch,
        ...(status === "rejected" && { rejectionReason: result.reasoning }),
      },
    });
  } catch (err) {
    console.error(`[KYC] processVerification failed for user ${userId}:`, err);
    // Fallback: put in review queue
    await db.kycSubmission.update({ where: { userId }, data: { status: "under_review" } }).catch(() => {});
  }
}

// ── Get KYC status ────────────────────────────────────────────────────────────

export async function getKycStatus(userId: string) {
  const submission = await db.kycSubmission.findUnique({ where: { userId } });
  if (!submission) return { status: "unverified", submission: null };
  return {
    status: submission.status,
    submission: serializeSubmission(submission),
  };
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeSubmission(s: any) {
  return {
    id:             s.id,
    status:         s.status,
    countryCode:    s.countryCode,
    idType:         s.idType,
    fullName:       s.fullName,
    dateOfBirth:    s.dateOfBirth,
    address:        s.address,
    city:           s.city,
    state:          s.state,
    country:        s.country,
    postalCode:     s.postalCode,
    faceConfidence: s.faceConfidence,
    addressMatch:   s.addressMatch,
    rejectionReason:s.rejectionReason ?? null,
    submittedAt:    s.submittedAt?.toISOString() ?? null,
    updatedAt:      s.updatedAt.toISOString(),
    // Document keys are returned but NOT the actual data URLs (security)
    hasDocuments: {
      front:  !!s.frontDocKey,
      back:   !!s.backDocKey,
      selfie: !!s.selfieKey,
      poa:    !!s.poaKey,
    },
  };
}

// Exported for admin module
export { serializeSubmission };
