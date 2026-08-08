/**
 * Import Graph Analyzer — Phase 14.2
 *
 * Parses every scanned file's import statements to build a directed
 * dependency graph of the project. This graph is the foundation for
 * impact analysis, root cause enrichment, confidence scoring, and
 * related-issue linking.
 *
 * NO AI calls. NO network. NO filesystem writes.
 * All analysis is derived from actual import statements in the scanned files.
 */

import * as path from "path";
import type { FileEntry } from "../scanners/projectDiscovery";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportGraph {
  /** file absolutePath → set of absolutePaths it imports */
  dependencies: Map<string, Set<string>>;
  /** file absolutePath → set of absolutePaths that import it */
  dependents:   Map<string, Set<string>>;
  /** all known absolute paths in the graph */
  nodes:        Set<string>;
  /** statistics */
  stats: {
    totalNodes: number;
    totalEdges: number;
    avgDependencies: number;
    avgDependents: number;
    mostImported: string | null;    // relativePath of most-imported file
    mostDependencies: string | null; // relativePath of file with most deps
  };
}

// ─── Import statement parsers ─────────────────────────────────────────────────

const IMPORT_PATTERNS: RegExp[] = [
  // Static ES import: import X from 'path', import { X } from 'path', import 'path'
  /(?:^|\n)\s*import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g,
  // Re-export: export { X } from 'path', export * from 'path'
  /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  // Dynamic import: import('path') — capture group 1 is the path
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS require: require('path')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function parseImportPaths(file: FileEntry): string[] {
  if (!file.content) return [];

  const raw = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.content)) !== null) {
      const imp = match[1];
      if (imp) raw.add(imp);
    }
  }

  // Filter to relative imports only — external packages can't be resolved
  const relative: string[] = [];
  for (const imp of raw) {
    if (imp.startsWith(".")) {
      relative.push(imp);
    }
    // Tsconfig path aliases starting with @ are project-internal — include
    // them if they don't look like npm scope packages (i.e. no npm registry hit)
    // For simplicity, skip @-prefixed paths (can't resolve without tsconfig)
  }

  return relative;
}

// ─── Path resolution ──────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function resolveRelativeImport(
  fromAbsDir: string,
  importPath: string,
  fileIndex: Map<string, string>, // normalized-no-ext-path → absolutePath
): string | null {
  const resolved = path.resolve(fromAbsDir, importPath);

  // Exact match (if already has extension)
  const direct = fileIndex.get(resolved);
  if (direct) return direct;

  // Try with common extensions
  for (const ext of EXTENSIONS) {
    const withExt = fileIndex.get(resolved + ext);
    if (withExt) return withExt;
  }

  // Try as directory index
  for (const ext of EXTENSIONS) {
    const withIndex = fileIndex.get(path.join(resolved, "index") + ext);
    if (withIndex) return withIndex;
  }

  return null;
}

// ─── Graph builder ────────────────────────────────────────────────────────────

export function buildImportGraph(files: FileEntry[], rootDir: string): ImportGraph {
  // Build lookup index: absolutePath → absolutePath (for exact) and
  // absolutePathWithoutExt → absolutePath (for extension resolution)
  const fileIndex = new Map<string, string>();
  for (const f of files) {
    fileIndex.set(f.absolutePath, f.absolutePath);
    const noExt = f.absolutePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
    fileIndex.set(noExt, f.absolutePath);
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents   = new Map<string, Set<string>>();
  const nodes        = new Set<string>();

  for (const f of files) {
    nodes.add(f.absolutePath);
    if (!dependencies.has(f.absolutePath)) dependencies.set(f.absolutePath, new Set());
    if (!dependents.has(f.absolutePath))   dependents.set(f.absolutePath,   new Set());
  }

  let totalEdges = 0;

  for (const file of files) {
    const importPaths = parseImportPaths(file);
    const fromDir     = path.dirname(file.absolutePath);

    for (const imp of importPaths) {
      const resolved = resolveRelativeImport(fromDir, imp, fileIndex);
      if (!resolved || resolved === file.absolutePath) continue; // skip self-imports

      dependencies.get(file.absolutePath)!.add(resolved);
      dependents.get(resolved)?.add(file.absolutePath);
      totalEdges++;
    }
  }

  // Compute stats
  let maxDependents = 0;
  let mostImported: string | null = null;
  let maxDeps = 0;
  let mostDependencies: string | null = null;

  for (const [abs, deps] of dependencies) {
    if (deps.size > maxDeps) {
      maxDeps = deps.size;
      mostDependencies = path.relative(rootDir, abs);
    }
  }

  for (const [abs, dpts] of dependents) {
    if (dpts.size > maxDependents) {
      maxDependents = dpts.size;
      mostImported = path.relative(rootDir, abs);
    }
  }

  const avgDependencies = files.length > 0
    ? Math.round([...dependencies.values()].reduce((s, d) => s + d.size, 0) / files.length * 10) / 10
    : 0;
  const avgDependents = files.length > 0
    ? Math.round([...dependents.values()].reduce((s, d) => s + d.size, 0) / files.length * 10) / 10
    : 0;

  return {
    dependencies,
    dependents,
    nodes,
    stats: {
      totalNodes:      nodes.size,
      totalEdges,
      avgDependencies,
      avgDependents,
      mostImported,
      mostDependencies,
    },
  };
}

// ─── Graph query helpers ──────────────────────────────────────────────────────

export function getDirectImporters(filePath: string, graph: ImportGraph): string[] {
  return [...(graph.dependents.get(filePath) ?? [])];
}

export function getDirectDependencies(filePath: string, graph: ImportGraph): string[] {
  return [...(graph.dependencies.get(filePath) ?? [])];
}

export function getTransitiveImporters(
  filePath: string,
  graph: ImportGraph,
  maxDepth = 4,
): string[] {
  const visited = new Set<string>();
  const queue: Array<{ p: string; depth: number }> = [{ p: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { p, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const importer of (graph.dependents.get(p) ?? [])) {
      if (!visited.has(importer) && importer !== filePath) {
        visited.add(importer);
        queue.push({ p: importer, depth: depth + 1 });
      }
    }
  }

  return [...visited];
}
