/**
 * KYC Verification Pipeline
 *
 * KYC_VERIFY_MODE env var controls the pipeline:
 *
 *   "mock"    — always returns high-confidence pass (test/demo use only)
 *   "manual"  — skips AI; every submission goes to the admin review queue (DEFAULT)
 *   "aws"     — real AWS Rekognition (face match) + Textract (address OCR)
 *
 * Thresholds match the frontend VerificationConfig.ts exactly:
 *   >= 85  → auto_approved
 *   70–84  → under_review  (admin queue)
 *   < 70   → auto_rejected
 *
 * TODO(production): Set KYC_VERIFY_MODE=aws and wire AWS credentials.
 *   Face match:    AWS Rekognition CompareFaces
 *   Address OCR:   AWS Textract DetectDocumentText → fuzzy match against submitted address
 *   Alternatives:  Azure Face API, Onfido, Jumio (drop-in replacement)
 */

export interface VerificationResult {
  faceConfidence: number;        // 0–100
  addressMatch:   boolean;
  verdict:        "auto_approved" | "under_review" | "auto_rejected";
  reasoning:      string;
}

const AUTO_APPROVE_THRESHOLD = 85;
const MANUAL_REVIEW_THRESHOLD = 70;

const VERIFY_MODE = process.env.KYC_VERIFY_MODE ?? "manual";

// ── Mock pipeline (dev/demo) ──────────────────────────────────────────────────

function mockVerify(): VerificationResult {
  const faceConfidence = 88 + Math.floor(Math.random() * 8); // 88–95
  return {
    faceConfidence,
    addressMatch: true,
    verdict:      "auto_approved",
    reasoning:    `[mock] Face confidence ${faceConfidence}% — address matched. Mock mode active.`,
  };
}

// ── Manual pipeline (safe default) ───────────────────────────────────────────

function manualVerify(): VerificationResult {
  return {
    faceConfidence: 75,   // falls in under_review band
    addressMatch:   true,
    verdict:        "under_review",
    reasoning:      "Manual review mode — all submissions queued for admin approval.",
  };
}

// ── AWS pipeline (production) ─────────────────────────────────────────────────

async function awsVerify(
  frontDocKey: string,
  selfieKey:   string,
  submittedAddress: string,
): Promise<VerificationResult> {
  // TODO(production): Implement real AWS calls.
  //
  // Face match:
  //   const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
  //   const resp = await rekognition.send(new CompareFacesCommand({
  //     SourceImage: { S3Object: { Bucket: ..., Name: frontDocKey } },
  //     TargetImage: { S3Object: { Bucket: ..., Name: selfieKey } },
  //     SimilarityThreshold: 70,
  //   }));
  //   const faceConfidence = resp.FaceMatches?.[0]?.Similarity ?? 0;
  //
  // Address OCR:
  //   const textract = new TextractClient({ region: process.env.AWS_REGION });
  //   const ocrResp = await textract.send(new DetectDocumentTextCommand({
  //     Document: { S3Object: { Bucket: ..., Name: poaKey } },
  //   }));
  //   const extractedText = ocrResp.Blocks?.filter(b => b.BlockType === "LINE").map(b => b.Text).join(" ") ?? "";
  //   const addressMatch = fuzzyMatch(extractedText, submittedAddress);
  //
  // Fallback to manual review on any AWS error.

  console.warn("[KYC] AWS mode selected but not implemented — falling back to manual review.");
  return manualVerify();
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runVerificationPipeline(opts: {
  frontDocKey:      string;
  selfieKey:        string;
  submittedAddress: string;
}): Promise<VerificationResult> {
  let result: VerificationResult;

  try {
    if (VERIFY_MODE === "mock") {
      result = mockVerify();
    } else if (VERIFY_MODE === "aws") {
      result = await awsVerify(opts.frontDocKey, opts.selfieKey, opts.submittedAddress);
    } else {
      result = manualVerify(); // default: "manual"
    }
  } catch (err) {
    console.error("[KYC] Verification pipeline error — defaulting to manual review:", err);
    result = manualVerify();
  }

  // Apply thresholds
  if (result.faceConfidence >= AUTO_APPROVE_THRESHOLD && result.addressMatch) {
    result.verdict = "auto_approved";
  } else if (result.faceConfidence >= MANUAL_REVIEW_THRESHOLD) {
    result.verdict = "under_review";
  } else {
    result.verdict = "auto_rejected";
  }

  return result;
}
