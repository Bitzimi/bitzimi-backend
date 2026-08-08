/**
 * Issue Detectors — Phase 14.1
 *
 * Pattern-based static analysis detectors. Each detector accepts a FileEntry
 * and returns zero or more raw Findings. No AI. No network. No filesystem writes.
 *
 * All detection is regex / heuristic — conservative, well-bounded, and
 * capped per file to prevent flooding the issue store.
 */

import * as path from "path";
import type { FileEntry } from "./projectDiscovery";

// ─── Finding (raw scan result, pre-DevIssue) ──────────────────────────────────

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type FindingCategory =
  | "authentication" | "authorization" | "data_validation" | "error_handling"
  | "performance"   | "security"      | "async_flow"       | "state_management"
  | "null_safety"   | "memory_leak"   | "race_condition"   | "api_integration"
  | "database"      | "build"         | "dependency"       | "ui_ux"
  | "type_safety"   | "configuration";

export type FindingLayer =
  | "frontend" | "backend" | "database" | "api"
  | "infrastructure" | "security" | "performance";

export interface Finding {
  detectorId:  string;
  severity:    FindingSeverity;
  category:    FindingCategory;
  layer:       FindingLayer;
  title:       string;
  description: string;
  rootCause:   string;
  file:        FileEntry;
  line:        number | null;
  suggestedApproaches: string[];
  impact:      string[];
  confidence:  number;
  matchedText?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lineOf(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function isTestFile(f: FileEntry): boolean {
  return (
    f.fileName.includes(".test.") ||
    f.fileName.includes(".spec.") ||
    f.relativeDir.includes("__tests__") ||
    f.relativeDir.includes("/tests/") ||
    f.relativeDir.includes("\\tests\\")
  );
}

function isBackend(f: FileEntry): boolean {
  return f.relativePath.startsWith("backend/");
}

function isRouteFile(f: FileEntry): boolean {
  return f.fileName.includes(".routes.") || f.fileName.includes("router");
}

function inferLayer(f: FileEntry): FindingLayer {
  if (f.relativePath.startsWith("backend/prisma/")) return "database";
  if (isBackend(f) && isRouteFile(f)) return "api";
  if (isBackend(f)) return "backend";
  return "frontend";
}

type Detector = (file: FileEntry) => Finding[];

// ─── 1. Console Log Detector ──────────────────────────────────────────────────

const consoleLogDetector: Detector = (file) => {
  if (!file.content || isTestFile(file)) return [];
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(file.extension)) return [];

  const findings: Finding[] = [];
  const pattern = /console\.(log|warn|debug|info)\s*\(/g;
  const layer = inferLayer(file);
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = pattern.exec(file.content)) !== null && count < 2) {
    const method = match[1];
    const lineNum = lineOf(file.content, match.index);
    const contextLine = (file.content.split("\n")[lineNum - 1] ?? "").trim();
    // Skip if in a comment
    if (contextLine.startsWith("//") || contextLine.startsWith("*")) continue;
    // Skip if guarded by NODE_ENV
    const surroundingLines = file.content.split("\n").slice(Math.max(0, lineNum - 3), lineNum + 1).join(" ");
    if (surroundingLines.includes("NODE_ENV") || surroundingLines.includes("isDev") || surroundingLines.includes("isDebug")) continue;

    count++;
    findings.push({
      detectorId: "console_log",
      severity:   isBackend(file) ? "medium" : "low",
      category:   isBackend(file) ? "security" : "performance",
      layer,
      title:       `Unguarded console.${method}() in ${path.basename(file.relativePath)}`,
      description: `Found \`console.${method}()\` at line ${lineNum} in \`${file.relativePath}\`. Unguarded console output in production code leaks internal state, degrades performance, and can expose sensitive data to browser devtools or server logs.`,
      rootCause:   `console.${method}() calls were added for debugging and not removed before production. Production ${isBackend(file) ? "server" : "browser"} environments should suppress all debug output.`,
      file,
      line: lineNum,
      confidence: 90,
      matchedText: `console.${method}(`,
      suggestedApproaches: [
        `Remove console.${method}() or replace with a structured logger that respects NODE_ENV`,
        isBackend(file)
          ? "Use a Fastify-compatible logger (Pino) with level filtering"
          : "Use a frontend logger utility that no-ops in production builds",
      ],
      impact: isBackend(file)
        ? ["security", "performance"]
        : ["performance", "user_experience"],
    });
  }

  return findings;
};

// ─── 2. Empty / Swallowed Catch Detector ──────────────────────────────────────

const emptyCatchDetector: Detector = (file) => {
  if (!file.content) return [];
  if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) return [];

  const findings: Finding[] = [];
  // Match catch blocks containing only whitespace, a comment, or nothing meaningful
  const pattern = /catch\s*\([^)]*\)\s*\{\s*(\/\/[^\n]*)?\s*\}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(file.content)) !== null && findings.length < 2) {
    const lineNum = lineOf(file.content, match.index);
    findings.push({
      detectorId: "empty_catch",
      severity:   "medium",
      category:   "error_handling",
      layer:      inferLayer(file),
      title:       `Silent error suppression (empty catch) in ${path.basename(file.relativePath)} at line ${lineNum}`,
      description: `An empty or comment-only catch block at line ${lineNum} in \`${file.relativePath}\` silently discards exceptions. Errors are swallowed without logging, rethrowing, or recovery, masking failures and making debugging extremely difficult.`,
      rootCause:   "Exception handler was left empty — either intentionally deferred or accidentally omitted. Silent catch blocks are rarely correct and prevent proper error telemetry.",
      file,
      line: lineNum,
      confidence: 88,
      suggestedApproaches: [
        "Add structured error logging inside the catch block",
        "Re-throw if the caller should handle the error",
        "If intentionally swallowing, add a comment explaining why and what error is expected",
      ],
      impact: ["runtime", "data_integrity"],
    });
  }

  return findings;
};

// ─── 3. TypeScript 'any' Type Detector ───────────────────────────────────────

const anyTypeDetector: Detector = (file) => {
  if (!file.content) return [];
  if (![".ts", ".tsx"].includes(file.extension)) return [];
  if (file.fileName.endsWith(".d.ts")) return [];

  const pattern = /(?::\s*any\b|<any\b|as\s+any\b)/g;
  let match: RegExpExecArray | null;
  let count = 0;
  let firstLine: number | null = null;

  while ((match = pattern.exec(file.content)) !== null) {
    const lineNum = lineOf(file.content, match.index);
    const contextLine = (file.content.split("\n")[lineNum - 1] ?? "").trim();
    if (contextLine.startsWith("//") || contextLine.startsWith("*")) continue;
    count++;
    if (firstLine === null) firstLine = lineNum;
  }

  if (count < 2) return []; // A single `any` in a large file is not worth flagging

  return [{
    detectorId: "any_type",
    severity:   "low",
    category:   "type_safety",
    layer:      inferLayer(file),
    title:       `TypeScript 'any' used ${count} times in ${path.basename(file.relativePath)}`,
    description: `Found ${count} uses of TypeScript \`any\` type in \`${file.relativePath}\`. Each \`any\` creates a type-safety hole: the compiler stops checking those values, making runtime type errors possible and reducing IDE autocompletion accuracy.`,
    rootCause:   "Excessive 'any' usage typically accumulates when migrating JavaScript to TypeScript, working with poorly typed third-party libraries, or deferring proper typing. Each is a debt item.",
    file,
    line: firstLine,
    confidence: 85,
    suggestedApproaches: [
      "Replace 'any' with a concrete type or interface",
      "Use 'unknown' instead of 'any' for values with unknown types — forces explicit narrowing",
      "Use generics for reusable code patterns instead of 'any'",
      "Enable 'noImplicitAny' in tsconfig.json to prevent new 'any' additions",
    ],
    impact: ["runtime", "compilation"],
  }];
};

// ─── 4. TODO / FIXME Comment Detector ────────────────────────────────────────

const todoCommentDetector: Detector = (file) => {
  if (!file.content) return [];

  const findings: Finding[] = [];
  const pattern = /\/\/\s*(TODO|FIXME|HACK|XXX|BUG|TEMP)\b([^\n]*)/gi;
  let match: RegExpExecArray | null;
  const seenLines = new Set<number>();

  while ((match = pattern.exec(file.content)) !== null && findings.length < 3) {
    const lineNum = lineOf(file.content, match.index);
    if (seenLines.has(lineNum)) continue;
    seenLines.add(lineNum);

    const tag     = match[1].toUpperCase();
    const comment = match[0].trim();
    const isCritical = tag === "BUG" || tag === "FIXME";

    findings.push({
      detectorId: "todo_comment",
      severity:   isCritical ? "low" : "informational",
      category:   "configuration",
      layer:      inferLayer(file),
      title:       `${tag}: deferred work marker in ${path.basename(file.relativePath)} at line ${lineNum}`,
      description: `A ${tag} comment at line ${lineNum} in \`${file.relativePath}\` marks incomplete or deferred work: \`${comment.substring(0, 120)}\`. These markers accumulate silently, creating undocumented technical debt.`,
      rootCause:   `${tag} comments are added during development to mark known issues or shortcuts, but are often never revisited. Without a tracking system, they become invisible debt.`,
      file,
      line: lineNum,
      confidence: 95,
      matchedText: comment.substring(0, 80),
      suggestedApproaches: [
        "Move this to the project issue tracker with appropriate priority",
        "Remove the comment if the work is no longer applicable",
        isCritical ? "BUG/FIXME markers indicate known defects — prioritise resolution" : "Set a milestone for resolution",
      ],
      impact: ["runtime"],
    });
  }

  return findings;
};

// ─── 5. Large File Detector ───────────────────────────────────────────────────

const largeFileDetector: Detector = (file) => {
  if (!file.lineCount) return [];
  // Skip generated / declaration files
  if (file.fileName.endsWith(".d.ts") || file.fileName.includes(".generated.")) return [];

  if (file.lineCount > 800) {
    return [{
      detectorId: "large_file_critical",
      severity:   "medium",
      category:   "build",
      layer:      inferLayer(file),
      title:       `Oversized file: ${path.basename(file.relativePath)} (${file.lineCount} lines)`,
      description: `\`${file.relativePath}\` contains ${file.lineCount} lines — significantly above the 400-line recommended maximum. Files this large accumulate unrelated concerns, increase merge conflict probability, slow IDE performance, and make code review impractical.`,
      rootCause:   "File grew organically as features were added without periodic refactoring into focused modules. Large files are a leading indicator of tangled responsibilities.",
      file,
      line: null,
      confidence: 98,
      suggestedApproaches: [
        "Identify distinct concerns within this file and extract them into separate modules",
        "Apply the Single Responsibility Principle: one file = one primary purpose",
        "For React components: extract sub-components, hooks, and utilities into separate files",
        "For services: split by domain boundary or feature area",
      ],
      impact: ["build", "performance"],
    }];
  }

  if (file.lineCount > 400) {
    return [{
      detectorId: "large_file",
      severity:   "low",
      category:   "build",
      layer:      inferLayer(file),
      title:       `Large file approaching limit: ${path.basename(file.relativePath)} (${file.lineCount} lines)`,
      description: `\`${file.relativePath}\` is ${file.lineCount} lines — approaching the 400-line recommended maximum. Proactive refactoring now is significantly easier than later.`,
      rootCause:   "File size grew incrementally. Each individual addition was small, but the cumulative effect creates a maintainability liability.",
      file,
      line: null,
      confidence: 95,
      suggestedApproaches: [
        "Review file structure and identify extraction opportunities",
        "Extract utility functions to a dedicated utils module",
      ],
      impact: ["build"],
    }];
  }

  return [];
};

// ─── 6. Hardcoded Value Detector ─────────────────────────────────────────────

const hardcodedValueDetector: Detector = (file) => {
  if (!file.content) return [];
  if (isTestFile(file)) return [];
  if ([".json", ".yaml", ".yml", ".toml", ".prisma"].includes(file.extension)) return [];
  if (file.fileName.includes("config")) return [];

  const findings: Finding[] = [];

  // Hardcoded credential-pattern strings (not in comments or env files)
  const credPattern = /(?:["'`])((?:secret|password|api[-_]?key|private[-_]?key|access[-_]?token)[^"'`]{0,40}(?:=|:)\s*["'`]?[A-Za-z0-9+/]{12,}["'`]?)/gi;
  let match: RegExpExecArray | null;
  while ((match = credPattern.exec(file.content)) !== null && findings.length === 0) {
    const lineNum = lineOf(file.content, match.index);
    const contextLine = (file.content.split("\n")[lineNum - 1] ?? "").trim();
    if (contextLine.startsWith("//") || contextLine.startsWith("*")) continue;
    if (contextLine.includes("process.env") || contextLine.includes("import.meta.env")) continue;

    findings.push({
      detectorId: "hardcoded_credential",
      severity:   "high",
      category:   "security",
      layer:      "security" as FindingLayer,
      title:       `Potential hardcoded credential in ${path.basename(file.relativePath)} at line ${lineNum}`,
      description: `A string matching a credential pattern was found at line ${lineNum} in \`${file.relativePath}\`. Hardcoded credentials are a critical security risk — they must be moved to environment variables and never committed to version control.`,
      rootCause:   "Credential was hardcoded for convenience during development and not moved to an environment variable before the code was committed.",
      file,
      line: lineNum,
      confidence: 72,
      suggestedApproaches: [
        "Move this value to a .env file and access via process.env.VAR_NAME",
        "Add .env to .gitignore if not already present",
        "Rotate the credential immediately if it has been committed to git history",
        "Use a secrets management service for production environments",
      ],
      impact: ["security", "authentication"],
    });
  }

  // Hardcoded localhost URLs in source (not config) files
  if (findings.length === 0) {
    const urlPattern = /["'`](http:\/\/localhost:\d{4,5}[^"'`]*?)["'`]/g;
    while ((match = urlPattern.exec(file.content)) !== null && findings.length === 0) {
      const lineNum = lineOf(file.content, match.index);
      const contextLine = (file.content.split("\n")[lineNum - 1] ?? "").trim();
      if (contextLine.startsWith("//") || contextLine.startsWith("*")) continue;

      findings.push({
        detectorId: "hardcoded_url",
        severity:   "low",
        category:   "configuration",
        layer:      inferLayer(file),
        title:       `Hardcoded localhost URL in ${path.basename(file.relativePath)} at line ${lineNum}`,
        description: `A hardcoded localhost URL (\`${match[1]}\`) was found at line ${lineNum} in \`${file.relativePath}\`. This will fail in all non-local environments (staging, production).`,
        rootCause:   "URL was hardcoded during local development. When the environment variable pattern (import.meta.env.VITE_API_URL / process.env.API_URL) is available, all hardcoded URLs should use it instead.",
        file,
        line: lineNum,
        confidence: 82,
        matchedText: match[1],
        suggestedApproaches: [
          "Replace with the environment variable: process.env.API_URL or import.meta.env.VITE_API_URL",
          "Define the base URL in a central configuration module",
        ],
        impact: ["api", "runtime"],
      });
    }
  }

  return findings;
};

// ─── 7. Async Without Error Handling Detector ─────────────────────────────────

const unhandledPromiseDetector: Detector = (file) => {
  if (!file.content) return [];
  if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) return [];
  if (isTestFile(file)) return [];

  // Find top-level .then() without .catch() in the same expression
  // Simple heuristic: .then( that is NOT followed by .catch within 300 chars
  const pattern = /\.then\s*\(/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = pattern.exec(file.content)) !== null) {
    const after = file.content.substring(match.index, match.index + 400);
    if (!after.includes(".catch(") && !after.includes("catch (") && !after.includes("catch(")) {
      count++;
    }
  }

  if (count >= 3) {
    return [{
      detectorId: "unhandled_promise",
      severity:   "medium",
      category:   "async_flow",
      layer:      inferLayer(file),
      title:       `${count} unhandled promise rejections possible in ${path.basename(file.relativePath)}`,
      description: `Found ${count} \`.then()\` chains in \`${file.relativePath}\` that appear to lack \`.catch()\` handlers. Unhandled promise rejections cause silent failures and can crash Node.js servers in newer runtime versions.`,
      rootCause:   "Promise chains were written optimistically without rejection handlers. In older codebases, unhandled rejections were silently ignored; modern runtimes terminate the process on unhandled rejection.",
      file,
      line: null,
      confidence: 68,
      suggestedApproaches: [
        "Add .catch() to each .then() chain or convert to async/await with try/catch",
        "Use a global unhandledRejection handler as a safety net (not a substitute for per-chain handling)",
        "Prefer async/await over .then() chains for cleaner error propagation",
      ],
      impact: ["runtime", "api"],
    }];
  }

  return [];
};

// ─── 8. Missing Null Check Detector ──────────────────────────────────────────

const nullSafetyDetector: Detector = (file) => {
  if (!file.content) return [];
  if (![".ts", ".tsx"].includes(file.extension)) return [];
  if (isTestFile(file)) return [];

  // Find non-null assertions (!) used more than a threshold
  const bangPattern = /[^\s!=<>?:]\!\.[a-zA-Z_$]/g;
  let match: RegExpExecArray | null;
  let count = 0;
  let firstLine: number | null = null;

  while ((match = bangPattern.exec(file.content)) !== null) {
    const lineNum = lineOf(file.content, match.index);
    const contextLine = (file.content.split("\n")[lineNum - 1] ?? "").trim();
    if (contextLine.startsWith("//") || contextLine.startsWith("*")) continue;
    count++;
    if (firstLine === null) firstLine = lineNum;
  }

  if (count >= 4) {
    return [{
      detectorId: "non_null_assertions",
      severity:   "low",
      category:   "null_safety",
      layer:      inferLayer(file),
      title:       `${count} non-null assertions (!) in ${path.basename(file.relativePath)}`,
      description: `Found ${count} TypeScript non-null assertion operators (\`!\`) in \`${file.relativePath}\`. Each assertion tells the compiler "I guarantee this is not null" — if that assumption is wrong at runtime, it causes an immediate TypeError crash.`,
      rootCause:   "Non-null assertions are typically added to satisfy the TypeScript compiler when the developer is confident a value exists but doesn't want to add defensive checks. They're often correct at the time of writing but become incorrect as data shapes evolve.",
      file,
      line: firstLine,
      confidence: 75,
      suggestedApproaches: [
        "Replace non-null assertions with optional chaining (?.) and nullish coalescing (??)",
        "Add explicit null checks where the value's presence is truly uncertain",
        "If the value is always present, refactor the type to not include null/undefined",
      ],
      impact: ["runtime", "data_integrity"],
    }];
  }

  return [];
};

// ─── 9. Prisma / Database Pattern Detector ───────────────────────────────────

const databasePatternDetector: Detector = (file) => {
  if (!file.content) return [];
  if (!isBackend(file)) return [];

  const findings: Finding[] = [];

  // N+1 query smell: db.X.findMany inside a loop or .map()
  const nPlusOnePattern = /(?:\.map|for\s*\(|forEach)\s*[^{]*\{[^}]{0,300}db\.[a-z]+\.find/gs;
  if (nPlusOnePattern.test(file.content)) {
    findings.push({
      detectorId: "n_plus_one_query",
      severity:   "medium",
      category:   "database",
      layer:      "database",
      title:       `Potential N+1 query pattern in ${path.basename(file.relativePath)}`,
      description: `\`${file.relativePath}\` contains what appears to be a database query inside a loop or \`.map()\`. This is the classic N+1 query problem: for N records, N+1 database round-trips are made instead of 1, causing exponential performance degradation at scale.`,
      rootCause:   "Individual record lookups performed inside iteration over a parent result set. Prisma provides \`include\`, \`select\`, and batch query APIs specifically to address this pattern.",
      file,
      line: null,
      confidence: 65,
      suggestedApproaches: [
        "Use Prisma 'include' to fetch related data in the parent query",
        "Use Promise.all() with a pre-built WHERE IN clause for batch lookups",
        "Consider using Prisma's findMany with a filter instead of iterating and looking up individually",
      ],
      impact: ["database", "performance"],
    });
  }

  // Select * equivalent: no 'select' field in findMany (fetches all columns)
  if (findings.length === 0) {
    const selectAllPattern = /db\.[a-z]+\.findMany\s*\(\s*\{(?![^)]{0,200}select\s*:)/g;
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = selectAllPattern.exec(file.content)) !== null) count++;
    if (count >= 2) {
      findings.push({
        detectorId: "db_select_all",
        severity:   "low",
        category:   "performance",
        layer:      "database",
        title:       `${count} unscoped findMany() queries in ${path.basename(file.relativePath)}`,
        description: `Found ${count} \`findMany()\` calls without a \`select\` clause in \`${file.relativePath}\`. These fetch every column from the table, including large text/binary fields that may not be needed, increasing query time and memory usage.`,
        rootCause:   "Queries written for convenience during development without scoping to only the fields the endpoint requires.",
        file,
        line: null,
        confidence: 72,
        suggestedApproaches: [
          "Add a 'select' clause to each findMany() to fetch only the fields the endpoint uses",
          "Create a Prisma select constant per use case for reuse",
        ],
        impact: ["database", "performance"],
      });
    }
  }

  return findings.slice(0, 1);
};

// ─── 10. Import/Dependency Detector ──────────────────────────────────────────

const importPatternDetector: Detector = (file) => {
  if (!file.content) return [];
  if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) return [];

  // Detect wildcard imports (import * as X)
  const wildcardPattern = /import\s+\*\s+as\s+\w+\s+from/g;
  let match: RegExpExecArray | null;
  let count = 0;
  let firstLine: number | null = null;

  while ((match = wildcardPattern.exec(file.content)) !== null) {
    const lineNum = lineOf(file.content, match.index);
    count++;
    if (firstLine === null) firstLine = lineNum;
  }

  if (count >= 2) {
    return [{
      detectorId: "wildcard_import",
      severity:   "low",
      category:   "build",
      layer:      inferLayer(file),
      title:       `${count} wildcard imports (import * as) in ${path.basename(file.relativePath)}`,
      description: `Found ${count} wildcard namespace imports in \`${file.relativePath}\`. Wildcard imports prevent tree-shaking: bundlers cannot determine which exports are actually used, so the entire module is included in the bundle even if only one function is needed.`,
      rootCause:   "Namespace imports are often used for convenience or when a module has many exports, but they defeat modern bundler optimizations.",
      file,
      line: firstLine,
      confidence: 80,
      suggestedApproaches: [
        "Replace 'import * as X from Y' with named imports: 'import { a, b } from Y'",
        "This allows tree-shaking to eliminate unused exports from the bundle",
      ],
      impact: ["build", "performance"],
    }];
  }

  return [];
};

// ─── Detector registry ────────────────────────────────────────────────────────

export const ALL_DETECTORS: ReadonlyArray<Detector> = [
  consoleLogDetector,
  emptyCatchDetector,
  anyTypeDetector,
  todoCommentDetector,
  largeFileDetector,
  hardcodedValueDetector,
  unhandledPromiseDetector,
  nullSafetyDetector,
  databasePatternDetector,
  importPatternDetector,
];

export function runDetectors(file: FileEntry): Finding[] {
  const findings: Finding[] = [];
  for (const detector of ALL_DETECTORS) {
    try {
      const results = detector(file);
      findings.push(...results);
    } catch {
      // Detector crash must never abort the scan
    }
  }
  return findings;
}
