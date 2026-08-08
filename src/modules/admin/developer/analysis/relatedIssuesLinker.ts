/**
 * Related Issues Linker — Phase 14.2
 *
 * Automatically discovers relationships between issues using:
 *   1. Same file — sibling co-location
 *   2. Same module + same category — pattern cluster
 *   3. Dependency chain — issue in file A links to issues in files that import A
 *   4. Same severity + category — cross-file pattern cluster (min 3 members)
 *
 * Returns a Map<issueId, relatedIssueId[]> — all relationships are bidirectional.
 *
 * NO AI. NO assumptions. Relationships derived from the actual project structure.
 */

import * as path from "path";
import type { DevIssue } from "../scanners/issueBuilder";
import type { ImportGraph } from "./importGraphAnalyzer";
import { getDirectImporters } from "./importGraphAnalyzer";

const MAX_RELATED_PER_ISSUE = 8;

export function linkRelatedIssues(
  issues: DevIssue[],
  graph: ImportGraph,
  rootDir: string,
): Map<string, string[]> {
  // Use Set<string> internally for de-duplication
  const relations = new Map<string, Set<string>>();
  for (const issue of issues) {
    relations.set(issue.id, new Set());
  }

  function link(a: string, b: string) {
    if (a === b) return;
    relations.get(a)?.add(b);
    relations.get(b)?.add(a);
  }

  // ── 1. Same file (sibling issues) ────────────────────────────────────────────
  const byFile = new Map<string, DevIssue[]>();
  for (const issue of issues) {
    const key = issue.file ?? "__no_file__";
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(issue);
  }
  for (const group of byFile.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        link(group[i].id, group[j].id);
      }
    }
  }

  // ── 2. Same module + same category ───────────────────────────────────────────
  const byModCat = new Map<string, DevIssue[]>();
  for (const issue of issues) {
    const key = `${issue.module}::${issue.category}`;
    if (!byModCat.has(key)) byModCat.set(key, []);
    byModCat.get(key)!.push(issue);
  }
  for (const group of byModCat.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        link(group[i].id, group[j].id);
      }
    }
  }

  // ── 3. Dependency chain ───────────────────────────────────────────────────────
  // Issue in file A → any issue in a file that directly imports A
  for (const issue of issues) {
    if (!issue.file) continue;
    const absPath  = path.resolve(rootDir, issue.file);
    const importers = getDirectImporters(absPath, graph);

    for (const other of issues) {
      if (!other.file || other.id === issue.id) continue;
      const otherAbs = path.resolve(rootDir, other.file);
      if (importers.includes(otherAbs)) {
        link(issue.id, other.id);
      }
    }
  }

  // ── 4. Cross-file pattern cluster (same severity + category, ≥3 members) ────
  const bySevCat = new Map<string, DevIssue[]>();
  for (const issue of issues) {
    const key = `${issue.severity}::${issue.category}`;
    if (!bySevCat.has(key)) bySevCat.set(key, []);
    bySevCat.get(key)!.push(issue);
  }
  for (const group of bySevCat.values()) {
    if (group.length < 3) continue;
    // Only cluster the first 10 to avoid combinatorial explosion
    const capped = group.slice(0, 10);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        link(capped[i].id, capped[j].id);
      }
    }
  }

  // ── Finalise: convert to capped arrays ───────────────────────────────────────
  const result = new Map<string, string[]>();
  for (const [id, set] of relations) {
    set.delete(id); // ensure no self-reference
    result.set(id, [...set].slice(0, MAX_RELATED_PER_ISSUE));
  }

  return result;
}
