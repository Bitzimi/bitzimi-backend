/**
 * AI Developer Center — Scanner + Analysis Service — Phase 14.2
 *
 * Orchestrates real filesystem scanning of the project root, then runs
 * the Phase 14.2 Intelligence Engine: import graph, root cause enrichment,
 * evidence-based confidence, and related-issue linking.
 *
 * HARD RULES (enforced here):
 * ─ NO AI API calls.
 * ─ NO internet access.
 * ─ NO filesystem writes.
 * ─ NO project source file modifications.
 * ─ All analysis is derived from actual scanned project data.
 */

import * as path from "path";
import { discoverFiles, buildProjectStructure, getScanDirs, classifyModule } from "./scanners/projectDiscovery";
import { runDetectors, type Finding } from "./scanners/issueDetectors";
import {
  buildIssues, resetCounter,
  type DevIssue, type IssueStatus, type IssueVerificationStatus,
} from "./scanners/issueBuilder";
// Phase 14.2 — Analysis Intelligence Engine
import { buildImportGraph }     from "./analysis/importGraphAnalyzer";
import { enrichRootCause }      from "./analysis/rootCauseAnalyzer";
import { calculateConfidence }  from "./analysis/confidenceEngine";
import { linkRelatedIssues }    from "./analysis/relatedIssuesLinker";
import { recordAnalysis, getAnalysisHistory as _getAnalysisHistory } from "./analysis/analysisHistory";
export type { AnalysisRecord } from "./analysis/analysisHistory";
// Phase 14.3 — Patch Engine
import { generatePatch as _generatePatch } from "./patches/patchGenerator";
import {
  storePatch, getPatchById, getPatchByIssueId,
  approvePatch as _approvePatch, rejectPatch as _rejectPatch,
  getPatchHistory, clearPatches,
} from "./patches/patchStore";
import { validatePatch as _validatePatch } from "./patches/patchValidator";
export type { PatchProposal, PatchHistoryEntry, PatchValidationResult } from "./patches/patchTypes";

// ─── Re-export for routes ──────────────────────────────────────────────────────

export type { DevIssue, IssueStatus, IssueVerificationStatus };

// ─── Frontend-mirrored types ──────────────────────────────────────────────────

export type ScanType = "full" | "deep" | "frontend" | "backend" | "database" | "api" | "integrations";

export interface ScanRecord {
  id:          string;
  scanType:    ScanType;
  startedAt:   string;
  completedAt: string | null;
  durationMs:  number | null;
  issuesFound: number;
  status:      "running" | "completed" | "failed" | "cancelled";
  triggeredBy: string;
}

export interface ScanProgress {
  scanId:        string;
  status:        "running" | "completed" | "failed";
  currentModule: string;
  filesScanned:  number;
  totalDiscovered: number;
  issuesFound:   number;
  startedAt:     string;
  completedAt:   string | null;
  durationMs:    number | null;
  errorMessage:  string | null;
}

export interface IssueSummary {
  critical:     number;
  high:         number;
  medium:       number;
  low:          number;
  informational: number;
  total:        number;
}

export type SystemHealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface SystemHealthCard {
  id:          string;
  name:        string;
  status:      SystemHealthStatus;
  lastChecked: string | null;
  detail?:     string;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const issueStore   = new Map<string, DevIssue>();
const scanStore    = new Map<string, ScanRecord>();
const progressMap  = new Map<string, ScanProgress>();
// Phase 14.3: finding store — maps issueId → Finding for patch generation
const findingStore = new Map<string, Finding>();

let scanCounter = 0;

function nextScanId(): string {
  scanCounter++;
  return `SCN-${String(scanCounter).padStart(4, "0")}`;
}

// ─── Project root ──────────────────────────────────────────────────────────────

// __dirname = .../backend/src/modules/admin/developer
// Project root = five levels up
const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");

// ─── Health card templates ────────────────────────────────────────────────────

const HEALTH_CARD_DEFS: Array<{ id: string; name: string }> = [
  { id: "frontend",  name: "Frontend"  },
  { id: "backend",   name: "Backend"   },
  { id: "database",  name: "Database"  },
  { id: "apis",      name: "APIs"      },
  { id: "websocket", name: "WebSocket" },
  { id: "cache",     name: "Cache"     },
  { id: "build",     name: "Build"     },
];

function buildHealthCards(issues: DevIssue[], lastChecked: string | null): SystemHealthCard[] {
  const countBySeverity = (layer: string) => {
    const layerIssues = issues.filter(
      (i) => i.status === "open" && (i.layer === layer || i.file?.startsWith(layer)),
    );
    const critical = layerIssues.filter((i) => i.severity === "critical").length;
    const high     = layerIssues.filter((i) => i.severity === "high").length;
    const medium   = layerIssues.filter((i) => i.severity === "medium").length;
    return { critical, high, medium, total: layerIssues.length };
  };

  const deriveStatus = (counts: { critical: number; high: number; medium: number }): SystemHealthStatus => {
    if (counts.critical > 0) return "critical";
    if (counts.high > 0)     return "warning";
    if (counts.medium > 0)   return "warning";
    return "healthy";
  };

  return HEALTH_CARD_DEFS.map(({ id, name }) => {
    if (lastChecked === null) {
      return { id, name, status: "unknown" as SystemHealthStatus, lastChecked: null };
    }
    const layerKey = id === "apis" ? "api" : id === "websocket" || id === "cache" ? "backend" : id;
    const counts   = countBySeverity(layerKey);
    const status   = deriveStatus(counts);
    const detail   = counts.total > 0
      ? `${counts.total} open issue${counts.total !== 1 ? "s" : ""} detected`
      : "No issues detected";

    return { id, name, status, lastChecked, detail };
  });
}

// ─── Scanner orchestrator ──────────────────────────────────────────────────────

export async function triggerScan(
  scanType: ScanType,
  triggeredBy: string,
): Promise<ScanProgress> {
  const scanId    = nextScanId();
  const startedAt = new Date().toISOString();
  const start     = Date.now();

  const scanRecord: ScanRecord = {
    id:          scanId,
    scanType,
    startedAt,
    completedAt: null,
    durationMs:  null,
    issuesFound: 0,
    status:      "running",
    triggeredBy,
  };
  scanStore.set(scanId, scanRecord);

  const progress: ScanProgress = {
    scanId,
    status:         "running",
    currentModule:  "Initialising",
    filesScanned:   0,
    totalDiscovered: 0,
    issuesFound:    0,
    startedAt,
    completedAt:    null,
    durationMs:     null,
    errorMessage:   null,
  };
  progressMap.set(scanId, progress);

  // Run async — does not block route handler
  setImmediate(async () => {
    try {
      const onlyDirs = getScanDirs(scanType);

      progress.currentModule = "Discovering files";
      progressMap.set(scanId, { ...progress });

      const files = await discoverFiles(PROJECT_ROOT, {
        maxFileSizeBytes: 512 * 1024,
        includeContent:   true,
        onlyDirs,
      });

      progress.totalDiscovered = files.length;
      progress.currentModule   = "Running detectors";
      progressMap.set(scanId, { ...progress });

      // Reset ID counter so each fresh scan starts at DEV-0001
      resetCounter();
      issueStore.clear();
      findingStore.clear();
      clearPatches();

      const allFindings: Finding[] = [];
      for (let i = 0; i < files.length; i++) {
        const file     = files[i];
        const findings = runDetectors(file);
        allFindings.push(...findings);
        progress.filesScanned  = i + 1;
        progress.currentModule = file.relativeDir || "root";
        progressMap.set(scanId, { ...progress });
      }

      const issues = buildIssues(allFindings);
      for (const issue of issues) {
        issueStore.set(issue.id, issue);
      }

      // ── Phase 14.2: Enrichment pipeline ─────────────────────────────────────
      progress.currentModule = "Building dependency graph";
      progressMap.set(scanId, { ...progress });

      const importGraph = buildImportGraph(files, PROJECT_ROOT);

      progress.currentModule = "Analysing root causes & impact";
      progressMap.set(scanId, { ...progress });

      // Build finding index keyed by issue ID (issues and findings are 1:1 in order)
      // Phase 14.3: also populate findingStore for patch generation
      const findingByIssueIdx = new Map<string, Finding>();
      for (let i = 0; i < issues.length && i < allFindings.length; i++) {
        findingByIssueIdx.set(issues[i].id, allFindings[i]);
        findingStore.set(issues[i].id, allFindings[i]);
      }

      const enrichmentStart = Date.now();
      for (const issue of issues) {
        const finding = findingByIssueIdx.get(issue.id);
        if (!finding) continue;

        const analysis   = enrichRootCause(finding, importGraph, PROJECT_ROOT);
        const confidence = calculateConfidence(finding, importGraph);

        Object.assign(issue, {
          confidence:                  confidence.score,
          technicalDescription:        analysis.technicalDescription,
          businessImpact:              analysis.businessImpact,
          evidenceFiles:               analysis.evidenceFiles,
          evidenceRefs:                analysis.evidenceRefs,
          estimatedComplexity:         analysis.estimatedComplexity,
          estimatedInvestigationHours: analysis.estimatedInvestigationHours,
          riskClassification:          analysis.riskClassification,
          directImporterCount:         analysis.directImporterCount,
          transitiveImporterCount:     analysis.transitiveImporterCount,
          dependencyPaths:             analysis.dependencyPaths,
          affectedRoutes:              analysis.affectedRoutes,
        });
        issueStore.set(issue.id, issue);
      }

      // Link related issues
      progress.currentModule = "Linking related issues";
      progressMap.set(scanId, { ...progress });

      const relationsMap = linkRelatedIssues(issues, importGraph, PROJECT_ROOT);
      for (const [issueId, relatedIds] of relationsMap) {
        const issue = issueStore.get(issueId);
        if (issue) { issue.relatedIssueIds = relatedIds; issueStore.set(issueId, issue); }
      }

      // Record analysis history
      const analysisRecord = recordAnalysis({
        scanId,
        timestamp:            new Date().toISOString(),
        filesAnalysed:        files.length,
        modulesAnalysed:      [...new Set(issues.map((i) => i.module))],
        dependenciesAnalysed: importGraph.stats.totalEdges,
        issuesAnalysed:       issues.length,
        durationMs:           Date.now() - enrichmentStart,
        analysisVersion:      "14.2.0",
        scannerVersion:       "14.1.0",
        graphNodeCount:       importGraph.stats.totalNodes,
        graphEdgeCount:       importGraph.stats.totalEdges,
      });

      // Stamp every issue with the analysis run ID
      for (const issue of issues) {
        issue.analysisId = analysisRecord.id;
        issueStore.set(issue.id, issue);
      }
      // ── End Phase 14.2 enrichment ────────────────────────────────────────────

      const completedAt = new Date().toISOString();
      const durationMs  = Date.now() - start;

      Object.assign(scanRecord, {
        completedAt,
        durationMs,
        issuesFound: issues.length,
        status:      "completed",
      });
      scanStore.set(scanId, scanRecord);

      Object.assign(progress, {
        status:      "completed",
        currentModule: "Complete",
        issuesFound: issues.length,
        completedAt,
        durationMs,
      });
      progressMap.set(scanId, progress);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const completedAt = new Date().toISOString();
      const durationMs  = Date.now() - start;

      Object.assign(scanRecord, { completedAt, durationMs, status: "failed" });
      scanStore.set(scanId, scanRecord);

      Object.assign(progress, {
        status:       "failed",
        completedAt,
        durationMs,
        errorMessage: msg,
      });
      progressMap.set(scanId, progress);
    }
  });

  return progress;
}

// ─── Query methods ────────────────────────────────────────────────────────────

export function getIssues(): { items: DevIssue[]; total: number } {
  const items = [...issueStore.values()].sort((a, b) => {
    const sev = ["critical", "high", "medium", "low", "informational"];
    return sev.indexOf(a.severity) - sev.indexOf(b.severity);
  });
  return { items, total: items.length };
}

export function getIssueById(id: string): DevIssue | null {
  return issueStore.get(id) ?? null;
}

export function updateIssue(
  id: string,
  patch: { status?: IssueStatus; verificationStatus?: IssueVerificationStatus },
): DevIssue | null {
  const issue = issueStore.get(id);
  if (!issue) return null;
  const updated: DevIssue = {
    ...issue,
    status:             patch.status             ?? issue.status,
    verificationStatus: patch.verificationStatus ?? issue.verificationStatus,
    updatedAt:          new Date().toISOString(),
    resolvedAt:
      (patch.status === "resolved" || patch.status === "verified") && !issue.resolvedAt
        ? new Date().toISOString()
        : issue.resolvedAt,
  };
  issueStore.set(id, updated);
  return updated;
}

export function getScanHistory(): { items: ScanRecord[]; total: number } {
  const items = [...scanStore.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  return { items, total: items.length };
}

export function getScanProgress(scanId: string): ScanProgress | null {
  return progressMap.get(scanId) ?? null;
}

export function getIssueSummary(): IssueSummary {
  const issues = [...issueStore.values()].filter((i) => i.status === "open");
  return {
    critical:     issues.filter((i) => i.severity === "critical").length,
    high:         issues.filter((i) => i.severity === "high").length,
    medium:       issues.filter((i) => i.severity === "medium").length,
    low:          issues.filter((i) => i.severity === "low").length,
    informational: issues.filter((i) => i.severity === "informational").length,
    total:        issues.length,
  };
}

export function getAnalysisHistory() {
  return _getAnalysisHistory();
}

export function getSystemHealth(): SystemHealthCard[] {
  const lastScan = [...scanStore.values()].sort((a, b) =>
    (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
  )[0];
  const lastChecked = lastScan?.completedAt ?? null;
  const issues      = [...issueStore.values()];
  return buildHealthCards(issues, lastChecked);
}

// ─── Phase 14.3: Patch service methods ────────────────────────────────────────

/**
 * Generate a real patch for the given issueId using the scanned finding.
 * Returns null if the detector type is unsupported or the file cannot be read.
 */
export function generatePatchForIssue(issueId: string) {
  const issue   = issueStore.get(issueId);
  const finding = findingStore.get(issueId);
  if (!issue || !finding) return null;

  // Check for an already-generated patch
  const existing = getPatchByIssueId(issueId);
  if (existing) return existing;

  const patch = _generatePatch(issue, finding, PROJECT_ROOT);
  if (!patch) return null;

  storePatch(patch);
  return patch;
}

export function getPatchForIssue(issueId: string) {
  return getPatchByIssueId(issueId);
}

export function getPatch(patchId: string) {
  return getPatchById(patchId);
}

export function approvePatchById(patchId: string, approvedBy: string) {
  return _approvePatch(patchId, approvedBy);
}

export function rejectPatchById(patchId: string, rejectedBy: string, reason: string) {
  return _rejectPatch(patchId, rejectedBy, reason);
}

export function getPatchAuditHistory() {
  return getPatchHistory();
}

export function validatePatch(patchId: string) {
  const patch = getPatchById(patchId);
  if (!patch) return null;
  return _validatePatch(patch, PROJECT_ROOT);
}
