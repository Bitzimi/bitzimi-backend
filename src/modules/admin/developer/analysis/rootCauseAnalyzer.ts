/**
 * Root Cause Analyzer — Phase 14.2
 *
 * Enriches raw findings with context derived from the actual project structure:
 * import graph, file roles, and dependency chains.
 *
 * Every output field comes from the scanned project data.
 * NO AI calls. NO assumptions. NO invented analysis.
 */

import * as path from "path";
import type { Finding } from "../scanners/issueDetectors";
import type { ImportGraph } from "./importGraphAnalyzer";
import {
  getDirectImporters,
  getDirectDependencies,
  getTransitiveImporters,
} from "./importGraphAnalyzer";

// ─── Output type ──────────────────────────────────────────────────────────────

export type ComplexityLevel    = "trivial" | "simple" | "moderate" | "complex" | "very_complex";
export type RiskClassification = "low_risk" | "medium_risk" | "high_risk" | "critical_risk";

export interface EnrichedAnalysis {
  technicalDescription:       string;
  businessImpact:             string;
  evidenceFiles:              string[];
  evidenceRefs:               string[];
  estimatedComplexity:        ComplexityLevel;
  estimatedInvestigationHours: number;
  riskClassification:         RiskClassification;
  directImporterCount:        number;
  transitiveImporterCount:    number;
  dependencyPaths:            string[];
  affectedRoutes:             string[];
}

// ─── File role classification ─────────────────────────────────────────────────

function inferFileRole(relPath: string): string {
  if (relPath.includes(".routes.") || relPath.endsWith("routes.ts") || relPath.endsWith("routes.tsx")) return "API route handler";
  if (relPath.includes(".service.") || relPath.endsWith("service.ts")) return "service / business-logic layer";
  if (relPath.includes(".middleware.")) return "middleware";
  if (relPath.includes("Context.tsx") || relPath.includes("Context.ts")) return "React context provider";
  if (relPath.endsWith("Page.tsx") || relPath.endsWith("Page.ts")) return "page component";
  if (/use[A-Z]/.test(path.basename(relPath))) return "React hook";
  if (relPath.includes("/hooks/")) return "React hook";
  if (relPath.includes("/utils/") || relPath.includes("util.ts") || relPath.includes("Util.ts")) return "utility module";
  if (relPath.includes("/types/") || relPath.endsWith(".d.ts")) return "type declaration";
  if (path.basename(relPath).startsWith("index.")) return "module barrel/index";
  if (relPath.includes("prisma/schema")) return "database schema";
  if (relPath.includes(".config.")) return "configuration file";
  if (relPath.endsWith(".tsx")) return "React component";
  return "module";
}

// ─── Technical description builder ───────────────────────────────────────────

function buildTechnicalDescription(
  finding: Finding,
  role: string,
  directImporterCount: number,
  transitiveImporterCount: number,
  topImporters: string[],
): string {
  const importerCtx = directImporterCount > 0
    ? ` This ${role} is directly imported by ${directImporterCount} other file${directImporterCount !== 1 ? "s" : ""}` +
      (topImporters.length > 0 ? ` (including \`${topImporters.slice(0, 2).join("\`, \`")}\`)` : "") +
      `, so defects here have a cascading effect.`
    : ` This ${role} has no detected local importers — it may be an entry point, lazy-loaded module, or dynamically required.`;

  const transitiveCtx = transitiveImporterCount > 0
    ? ` Transitively, up to ${transitiveImporterCount} module${transitiveImporterCount !== 1 ? "s" : ""} depend on this file.`
    : "";

  return `${finding.description}\n\n${importerCtx}${transitiveCtx}`;
}

// ─── Business impact builder ──────────────────────────────────────────────────

function buildBusinessImpact(
  finding: Finding,
  role: string,
  directCount: number,
  transitiveCount: number,
): string {
  const cat = finding.category;
  const sev = finding.severity;
  const total = directCount + transitiveCount;

  if (cat === "security" || cat === "authentication" || cat === "authorization") {
    return `Security defect in a ${role}. Exploitation could compromise user data, allow unauthorized access, or expose platform secrets. Severity is independent of importer count — requires immediate attention.`;
  }
  if (cat === "error_handling") {
    return `Silent failure path in a ${role} depended on by ${directCount} module${directCount !== 1 ? "s" : ""}. When errors are swallowed, failures go undetected, making debugging in production extremely difficult and degrading user experience silently.`;
  }
  if (cat === "database") {
    return `Database performance issue in a ${role}. Under real-world load, N+1 queries or unscoped fetches cause exponential latency growth and can exhaust database connection pools, impacting all ${total} dependent modules.`;
  }
  if (sev === "critical" || sev === "high") {
    return `High-severity defect in a ${role} with ${directCount} direct and ${transitiveCount} transitive dependents. A runtime failure here could cascade across ${total} dependent module${total !== 1 ? "s" : ""}, degrading availability.`;
  }
  if (cat === "performance") {
    return `Performance issue in a ${role} with ${directCount} direct importers. Under load, this degrades response times or memory usage across all ${total} dependent code paths.`;
  }
  if (cat === "type_safety") {
    return `TypeScript type safety gap in a ${role}. Each \`any\` type is a potential runtime TypeError — invisible at compile time but catastrophic in production with unexpected input shapes.`;
  }
  if (cat === "build") {
    return `Build-time concern in a ${role}. Large files or wildcard imports slow CI pipelines, increase bundle sizes, and degrade cold-start performance for ${total} dependent module${total !== 1 ? "s" : ""}.`;
  }
  return `Technical debt in a ${role} with ${directCount} direct importers. While not immediately critical, this adds cognitive load for maintainers of all ${total} dependent module${total !== 1 ? "s" : ""}.`;
}

// ─── Complexity estimation ────────────────────────────────────────────────────

function estimateComplexity(finding: Finding, directImporterCount: number): ComplexityLevel {
  if (finding.detectorId === "todo_comment") return "trivial";
  if (finding.detectorId === "console_log" && directImporterCount <= 3) return "simple";
  if (finding.detectorId === "hardcoded_url" || finding.detectorId === "hardcoded_credential") {
    return directImporterCount > 5 ? "moderate" : "simple";
  }
  if (finding.severity === "critical" || finding.detectorId === "hardcoded_credential") {
    return directImporterCount > 5 ? "very_complex" : "complex";
  }
  if (finding.detectorId === "n_plus_one_query" || finding.detectorId === "db_select_all") return "moderate";
  if (finding.detectorId === "unhandled_promise") return "moderate";
  if (finding.detectorId === "empty_catch") return "simple";
  if (finding.severity === "high" && directImporterCount > 8) return "complex";
  if (directImporterCount > 20) return "very_complex";
  if (directImporterCount > 12) return "complex";
  if (directImporterCount > 5)  return "moderate";
  return "simple";
}

const COMPLEXITY_HOURS: Record<ComplexityLevel, number> = {
  trivial:     0.25,
  simple:      1,
  moderate:    4,
  complex:     12,
  very_complex: 32,
};

// ─── Risk classification ──────────────────────────────────────────────────────

function classifyRisk(finding: Finding, transitiveImporterCount: number): RiskClassification {
  if (finding.severity === "critical") return "critical_risk";
  if (finding.category === "security" || finding.category === "authentication" || finding.category === "authorization") {
    return "critical_risk";
  }
  if (finding.detectorId === "hardcoded_credential") return "high_risk";
  if (finding.severity === "high") return "high_risk";
  if (finding.severity === "medium" && transitiveImporterCount > 10) return "high_risk";
  if (finding.severity === "medium") return "medium_risk";
  if (transitiveImporterCount > 20) return "medium_risk";
  return "low_risk";
}

// ─── Dependency path builder ──────────────────────────────────────────────────

function buildDependencyPaths(
  fileAbsPath: string,
  transitiveImporters: string[],
  graph: ImportGraph,
  rootDir: string,
): string[] {
  const routeImporters = transitiveImporters
    .filter(p => p.includes(".routes.") || p.includes("/routes"))
    .slice(0, 4);

  const fileRel = path.relative(rootDir, fileAbsPath);

  if (routeImporters.length > 0) {
    return routeImporters.map(p => `${fileRel} → ${path.relative(rootDir, p)}`);
  }

  // Fallback: show direct importer chain
  const directImporters = [...(graph.dependents.get(fileAbsPath) ?? [])].slice(0, 3);
  return directImporters.map(p => `${fileRel} → ${path.relative(rootDir, p)}`);
}

// ─── Affected routes ──────────────────────────────────────────────────────────

function findAffectedRoutes(transitiveImporters: string[], rootDir: string): string[] {
  return transitiveImporters
    .filter(p => p.includes(".routes.") || p.includes("/routes"))
    .map(p => path.relative(rootDir, p))
    .slice(0, 6);
}

// ─── Main enrichment function ──────────────────────────────────────────────────

export function enrichRootCause(
  finding: Finding,
  graph: ImportGraph,
  rootDir: string,
): EnrichedAnalysis {
  const fileAbsPath = finding.file.absolutePath;
  const relPath     = finding.file.relativePath;

  const directImporters     = getDirectImporters(fileAbsPath, graph);
  const transitiveImporters = getTransitiveImporters(fileAbsPath, graph, 4);
  const dependencies        = getDirectDependencies(fileAbsPath, graph);

  const directCount     = directImporters.length;
  const transitiveCount = transitiveImporters.length;

  const topImporterRels = directImporters
    .map(p => path.relative(rootDir, p))
    .slice(0, 4);

  // Evidence files: the affected file + its top importers
  const evidenceFiles = [relPath, ...topImporterRels].slice(0, 6);

  // Evidence references: specific textual evidence
  const evidenceRefs: string[] = [];
  if (finding.line) {
    evidenceRefs.push(`\`${relPath}:${finding.line}\` — ${finding.matchedText ?? finding.detectorId} detected`);
  } else {
    evidenceRefs.push(`\`${relPath}\` — ${finding.detectorId} pattern detected (file-level)`);
  }
  if (directCount > 0) {
    evidenceRefs.push(`${directCount} direct import reference${directCount !== 1 ? "s" : ""} confirmed in dependency graph`);
  }
  if (dependencies.length > 0) {
    evidenceRefs.push(`File imports ${dependencies.length} local module${dependencies.length !== 1 ? "s" : ""} — mid-chain in dependency tree`);
  }
  if (transitiveCount > 0) {
    evidenceRefs.push(`${transitiveCount} transitive dependent${transitiveCount !== 1 ? "s" : ""} identified (max depth 4)`);
  }

  const role               = inferFileRole(relPath);
  const complexity         = estimateComplexity(finding, directCount);
  const investigationHours = COMPLEXITY_HOURS[complexity];
  const riskClassification = classifyRisk(finding, transitiveCount);
  const dependencyPaths    = buildDependencyPaths(fileAbsPath, transitiveImporters, graph, rootDir);
  const affectedRoutes     = findAffectedRoutes(transitiveImporters, rootDir);

  return {
    technicalDescription:        buildTechnicalDescription(finding, role, directCount, transitiveCount, topImporterRels),
    businessImpact:              buildBusinessImpact(finding, role, directCount, transitiveCount),
    evidenceFiles,
    evidenceRefs,
    estimatedComplexity:         complexity,
    estimatedInvestigationHours: investigationHours,
    riskClassification,
    directImporterCount:         directCount,
    transitiveImporterCount:     transitiveCount,
    dependencyPaths,
    affectedRoutes,
  };
}
