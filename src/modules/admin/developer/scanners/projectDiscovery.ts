/**
 * Project Discovery — Phase 14.1
 *
 * Walks the project filesystem and collects file metadata + content for scanning.
 * Uses only Node.js built-in fs module. No network calls. No filesystem writes.
 */

import * as fs from "fs/promises";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  directory: string;
  relativeDir: string;
  sizeBytes: number;
  lineCount: number | null;
  content: string | null;
}

export interface DiscoveryOptions {
  maxFileSizeBytes?: number;
  includeContent?: boolean;
  maxDepth?: number;
  onlyDirs?: string[];   // if set, only walk these subdirs of rootDir
}

export interface ProjectStructure {
  totalFiles: number;
  totalFolders: number;
  rootDir: string;
  modules: { name: string; fileCount: number; path: string }[];
  filesByExtension: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".vite", "coverage",
  ".turbo", ".next", ".nuxt", "out", ".output", "__pycache__",
  ".cache", "tmp", ".tmp", ".pnpm-store",
]);

const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".prisma", ".yaml", ".yml", ".toml",
]);

// ─── Walker ───────────────────────────────────────────────────────────────────

export async function discoverFiles(
  rootDir: string,
  options: DiscoveryOptions = {},
): Promise<FileEntry[]> {
  const {
    maxFileSizeBytes = 512 * 1024,
    includeContent = true,
    maxDepth = 15,
    onlyDirs,
  } = options;

  const results: FileEntry[] = [];
  const foldersSeen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (foldersSeen.has(dir)) return;
    foldersSeen.add(dir);

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.allSettled(
      entries.map(async (entry) => {
        if (entry.isDirectory()) {
          if (
            !EXCLUDE_DIRS.has(entry.name) &&
            !entry.name.startsWith(".")
          ) {
            await walk(path.join(dir, entry.name), depth + 1);
          }
          return;
        }
        if (!entry.isFile()) return;

        const ext = path.extname(entry.name).toLowerCase();
        if (!SCANNABLE_EXTENSIONS.has(ext)) return;

        const absolutePath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, absolutePath);

        let sizeBytes = 0;
        let content: string | null = null;
        let lineCount: number | null = null;

        try {
          const stat = await fs.stat(absolutePath);
          sizeBytes = stat.size;

          if (includeContent && sizeBytes <= maxFileSizeBytes) {
            content = await fs.readFile(absolutePath, "utf-8");
            lineCount = content.split("\n").length;
          }
        } catch {
          return;
        }

        results.push({
          absolutePath,
          relativePath,
          fileName: entry.name,
          extension: ext,
          directory: path.dirname(absolutePath),
          relativeDir: path.relative(rootDir, path.dirname(absolutePath)),
          sizeBytes,
          lineCount,
          content,
        });
      }),
    );
  }

  if (onlyDirs && onlyDirs.length > 0) {
    await Promise.allSettled(
      onlyDirs.map((sub) => walk(path.join(rootDir, sub), 0)),
    );
  } else {
    await walk(rootDir, 0);
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function classifyLayer(relativePath: string): string {
  if (relativePath.startsWith("backend/prisma/")) return "database";
  if (
    relativePath.startsWith("backend/") &&
    (relativePath.includes(".routes.") || relativePath.includes("/routes"))
  ) return "api";
  if (relativePath.startsWith("backend/")) return "backend";
  if (relativePath.startsWith("src/")) return "frontend";
  return "infrastructure";
}

export function classifyModule(relativePath: string): string {
  const parts = relativePath.split("/");
  const modIdx = parts.indexOf("modules");
  if (modIdx >= 0 && parts[modIdx + 1]) return parts[modIdx + 1];
  const adminIdx = parts.indexOf("admin");
  if (adminIdx >= 0 && parts[adminIdx + 1]) return parts[adminIdx + 1];
  const appIdx = parts.indexOf("app");
  if (appIdx >= 0 && parts[appIdx + 1]) return parts[appIdx + 1];
  return parts[0] ?? "root";
}

export async function buildProjectStructure(
  rootDir: string,
  files: FileEntry[],
): Promise<ProjectStructure> {
  const folderCounts = new Map<string, number>();
  const extCounts: Record<string, number> = {};
  const moduleCounts = new Map<string, { count: number; path: string }>();

  for (const f of files) {
    folderCounts.set(f.relativeDir, (folderCounts.get(f.relativeDir) ?? 0) + 1);
    extCounts[f.extension] = (extCounts[f.extension] ?? 0) + 1;

    const mod = classifyModule(f.relativePath);
    if (!moduleCounts.has(mod)) {
      moduleCounts.set(mod, { count: 0, path: f.relativeDir });
    }
    moduleCounts.get(mod)!.count++;
  }

  return {
    totalFiles: files.length,
    totalFolders: folderCounts.size,
    rootDir,
    modules: [...moduleCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([name, v]) => ({ name, fileCount: v.count, path: v.path })),
    filesByExtension: extCounts,
  };
}

export function getScanDirs(scanType: string): string[] | undefined {
  switch (scanType) {
    case "frontend":    return ["src"];
    case "backend":     return ["backend/src"];
    case "database":    return ["backend/prisma", "backend/src/modules"];
    case "api":         return ["backend/src/modules", "backend/src"];
    case "integrations": return ["backend/src", "src/app/services"];
    case "full":
    case "deep":
    default:            return undefined; // full project
  }
}
