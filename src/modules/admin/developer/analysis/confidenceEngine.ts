/**
 * Confidence Engine — Phase 14.2
 *
 * Recalculates confidence scores using evidence gathered from the
 * actual project: dependency graph, file role, detection precision,
 * and usage evidence.
 *
 * Replaces the hardcoded detector-level confidence values with
 * evidence-weighted scores.
 *
 * NO AI calls. NO assumptions. All inputs come from the scanned project.
 */

import type { Finding } from "../scanners/issueDetectors";
import type { ImportGraph } from "./importGraphAnalyzer";
import { getDirectImporters } from "./importGraphAnalyzer";

// ─── Output ───────────────────────────────────────────────────────────────────

export interface ConfidenceResult {
  score:     number;   // 0–100 final weighted score
  breakdown: ConfidenceBreakdown[];
}

export interface ConfidenceBreakdown {
  factor: string;
  score:  number;
  weight: number;
}

// ─── Evidence-based confidence calculation ────────────────────────────────────

export function calculateConfidence(
  finding: Finding,
  graph: ImportGraph,
): ConfidenceResult {
  const breakdown: ConfidenceBreakdown[] = [];

  // ── Factor 1: Pattern match specificity (from detector, 50% weight) ─────────
  // The detector already set a base confidence. Higher = more specific pattern.
  breakdown.push({
    factor: "Pattern match specificity",
    score:  finding.confidence,
    weight: 0.50,
  });

  // ── Factor 2: File is actually used (import references, 20% weight) ─────────
  const directImporters   = getDirectImporters(finding.file.absolutePath, graph);
  const importerCount     = directImporters.length;
  // Files imported by others are definitively in-use production code.
  // Unimported files might be dead code or entry points.
  const usageScore = importerCount >= 5 ? 95
    : importerCount >= 2 ? 85
    : importerCount === 1 ? 75
    : 50; // no importers found — could be entry point or dead code
  breakdown.push({
    factor: `File usage evidence (${importerCount} import reference${importerCount !== 1 ? "s" : ""} in graph)`,
    score:  usageScore,
    weight: 0.20,
  });

  // ── Factor 3: Context (production code vs test / config, 15% weight) ────────
  const relPath = finding.file.relativePath;
  const isTest  = relPath.includes(".test.") || relPath.includes(".spec.") || relPath.includes("__tests__");
  const isConfig = relPath.includes("config.") || finding.file.extension === ".json" || finding.file.extension === ".toml";
  const contextScore = isTest ? 45 : isConfig ? 60 : 92;
  const contextLabel = isTest ? "test file (lower confidence)" : isConfig ? "config file" : "production source file";
  breakdown.push({
    factor: `Context: ${contextLabel}`,
    score:  contextScore,
    weight: 0.15,
  });

  // ── Factor 4: Detection precision (line-level vs file-level, 15% weight) ────
  const hasLine    = finding.line !== null;
  const hasMatch   = !!finding.matchedText;
  const lineScore  = hasLine && hasMatch ? 95 : hasLine ? 85 : 65;
  const lineLabel  = hasLine ? `line ${finding.line} identified` : "file-level detection";
  breakdown.push({
    factor: `Detection precision: ${lineLabel}`,
    score:  lineScore,
    weight: 0.15,
  });

  // ── Weighted sum ─────────────────────────────────────────────────────────────
  const rawScore = breakdown.reduce((sum, b) => sum + b.score * b.weight, 0);
  const finalScore = Math.min(99, Math.max(40, Math.round(rawScore)));

  return { score: finalScore, breakdown };
}
