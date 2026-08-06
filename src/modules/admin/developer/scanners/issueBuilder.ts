/**
 * Issue Builder — Phase 14.1
 *
 * Converts raw scanner Findings into DevIssue records that match the
 * frontend's DevIssue interface exactly. Assigns stable IDs and enriches
 * fields that the pattern detectors cannot determine on their own.
 *
 * NO AI calls. NO network access. NO filesystem writes.
 */

import * as path from "path";
import type { Finding } from "./issueDetectors";
import { classifyModule } from "./projectDiscovery";

// ─── DevIssue shape (mirrors frontend developerService.ts) ────────────────────

export type IssueSeverity          = "critical" | "high" | "medium" | "low" | "informational";
export type IssueCategory =
  | "authentication" | "authorization" | "data_validation" | "error_handling"
  | "performance"   | "security"       | "async_flow"       | "state_management"
  | "null_safety"   | "memory_leak"    | "race_condition"   | "api_integration"
  | "database"      | "build"          | "dependency"       | "ui_ux"
  | "type_safety"   | "configuration";
export type IssueLayer             = "frontend" | "backend" | "database" | "api" | "infrastructure" | "security" | "performance";
export type IssueStatus            = "open" | "under_review" | "resolved" | "wont_fix" | "verified";
export type IssueVerificationStatus = "unverified" | "under_review" | "verified" | "false_positive" | "closed";
export type ImpactArea             =
  | "performance" | "security" | "data_integrity" | "user_experience"
  | "build"       | "compilation" | "runtime"     | "financial"
  | "gameplay"    | "authentication" | "admin"    | "api" | "database";

export type ComplexityLevel    = "trivial" | "simple" | "moderate" | "complex" | "very_complex";
export type RiskClassification = "low_risk" | "medium_risk" | "high_risk" | "critical_risk";

export interface DevIssue {
  id:                  string;
  severity:            IssueSeverity;
  confidence:          number;
  category:            IssueCategory;
  layer:               IssueLayer;
  module:              string;
  component:           string;
  file:                string | null;
  folder:              string | null;
  line:                number | null;
  status:              IssueStatus;
  verificationStatus:  IssueVerificationStatus;
  title:               string;
  description:         string;
  rootCause:           string;
  impact:              ImpactArea[];
  dependencies:        string[];
  affectedComponents:  string[];
  suggestedApproaches: string[];
  createdAt:           string;
  updatedAt:           string;
  resolvedAt:          string | null;
  reportedBy:          string;
  verifiedBy:          string | null;

  // Phase 14.2 — Analysis Intelligence Engine (all optional)
  evidenceFiles?:               string[];
  evidenceRefs?:                string[];
  relatedIssueIds?:             string[];
  estimatedComplexity?:         ComplexityLevel;
  estimatedInvestigationHours?: number;
  riskClassification?:          RiskClassification;
  businessImpact?:              string;
  technicalDescription?:        string;
  affectedRoutes?:              string[];
  dependencyPaths?:             string[];
  directImporterCount?:         number;
  transitiveImporterCount?:     number;
  analysisId?:                  string;
}

// ─── Counter ──────────────────────────────────────────────────────────────────

let counter = 0;

export function resetCounter(): void {
  counter = 0;
}

function nextId(): string {
  counter++;
  return `DEV-${String(counter).padStart(4, "0")}`;
}

// ─── Impact area normaliser ───────────────────────────────────────────────────

const VALID_IMPACT: ReadonlySet<string> = new Set<ImpactArea>([
  "performance", "security", "data_integrity", "user_experience",
  "build", "compilation", "runtime", "financial",
  "gameplay", "authentication", "admin", "api", "database",
]);

function normaliseImpact(raw: string[]): ImpactArea[] {
  return raw.filter((v): v is ImpactArea => VALID_IMPACT.has(v));
}

// ─── Component name from file path ───────────────────────────────────────────

function componentName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  // Strip common suffixes for cleaner names
  return base
    .replace(/\.(routes|service|controller|middleware|spec|test|d)$/, "")
    .replace(/Page$/, "")
    || base;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildIssue(finding: Finding, now: string): DevIssue {
  const relativePath = finding.file.relativePath;
  const relativeDir  = finding.file.relativeDir;

  return {
    id:                  nextId(),
    severity:            finding.severity as IssueSeverity,
    confidence:          finding.confidence,
    category:            finding.category as IssueCategory,
    layer:               finding.layer as IssueLayer,
    module:              classifyModule(relativePath),
    component:           componentName(relativePath),
    file:                relativePath,
    folder:              relativeDir || null,
    line:                finding.line,
    status:              "open",
    verificationStatus:  "unverified",
    title:               finding.title,
    description:         finding.description,
    rootCause:           finding.rootCause,
    impact:              normaliseImpact(finding.impact),
    dependencies:        [],
    affectedComponents:  [componentName(relativePath)],
    suggestedApproaches: finding.suggestedApproaches,
    createdAt:           now,
    updatedAt:           now,
    resolvedAt:          null,
    reportedBy:          "scanner",
    verifiedBy:          null,
  };
}

export function buildIssues(findings: Finding[]): DevIssue[] {
  const now = new Date().toISOString();
  return findings.map((f) => buildIssue(f, now));
}
