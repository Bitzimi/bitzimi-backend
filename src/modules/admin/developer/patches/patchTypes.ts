/**
 * Patch Engine Types — Phase 14.3
 *
 * Mirror of frontend patchService.ts types. Both sides must remain structurally
 * identical so the backend can produce objects the frontend renders without
 * any transformation.
 *
 * HARD RULES:
 * ─ NO AI calls.
 * ─ NO internet access.
 * ─ NO filesystem writes.
 * ─ Types only — no runtime logic in this file.
 */

// ─── Risk ─────────────────────────────────────────────────────────────────────

export type PatchRiskLevel =
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type PatchComplexity =
  | "trivial"
  | "simple"
  | "moderate"
  | "complex"
  | "very_complex";

// ─── Approval ─────────────────────────────────────────────────────────────────

export type PatchApprovalStatus =
  | "pending_review"
  | "approved"
  | "rejected";

// ─── Diff ─────────────────────────────────────────────────────────────────────

export type PatchDiffLineType = "added" | "removed" | "unchanged" | "hunk";

export interface PatchDiffLine {
  type: PatchDiffLineType;
  lineNumBefore: number | null;
  lineNumAfter: number | null;
  content: string;
}

export interface PatchFile {
  filePath: string;
  language: string;
  diff: PatchDiffLine[];
  linesAdded: number;
  linesRemoved: number;
}

// ─── Risk assessment ──────────────────────────────────────────────────────────

export interface PatchRiskDimension {
  area: string;
  level: PatchRiskLevel;
  reason: string;
}

export interface PatchRiskAssessment {
  overall: PatchRiskLevel;
  overallReason: string;
  confidence: number;
  dimensions: PatchRiskDimension[];
}

// ─── Explain fix ──────────────────────────────────────────────────────────────

export interface ExplainFix {
  whyIssueExists: string;
  whyItHappens: string;
  whySolutionWorks: string;
  possibleSideEffects: string[];
  possibleAlternatives: string[];
  tradeoffs: string[];
  dependencies: string[];
  affectedSystems: string[];
  expectedOutcome: string;
}

// ─── Core proposal ────────────────────────────────────────────────────────────

export interface PatchProposal {
  // Identity
  id: string;              // PAT-XXXX
  issueId: string;         // DEV-XXXX

  // Context (mirrored from DevIssue for standalone display)
  title: string;
  severity: string;
  confidence: number;
  affectedLayer: string;
  affectedModule: string;
  affectedFile: string | null;
  affectedFolder: string | null;
  affectedLine: number | null;

  // Analysis summary
  rootCause: string;
  summary: string;
  proposedSolution: string;
  expectedResult: string;

  // Complexity
  estimatedComplexity: PatchComplexity;
  totalFilesAffected: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;

  // Diff
  files: PatchFile[];

  // Risk
  riskAssessment: PatchRiskAssessment;

  // Explanation
  explainFix: ExplainFix;

  // Approval workflow
  approvalStatus: PatchApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;

  // Attribution
  generatedAt: string;
  generatedBy: string;
}

// ─── Patch audit record ───────────────────────────────────────────────────────

export interface PatchHistoryEntry {
  id: string;                       // PHIST-XXXX
  patchId: string;
  issueId: string;
  action: "generated" | "approved" | "rejected" | "applied" | "rolled_back";
  performedBy: string;
  performedAt: string;
  detail: string | null;
}

// ─── Validation result ────────────────────────────────────────────────────────

export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fileChecks: Array<{
    filePath: string;
    exists: boolean;
    lineCountMatch: boolean;
    hashMatch: boolean;
    error: string | null;
  }>;
}
