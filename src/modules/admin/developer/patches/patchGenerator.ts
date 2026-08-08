/**
 * Real Patch Generator — Phase 14.3
 *
 * Generates deterministic, read-only patch proposals from actual scanned project
 * files. Every patch contains exact file paths, real line numbers, real before/after
 * code, and a unified diff computed from the live file content on disk.
 *
 * Supported detector IDs (produce real patches):
 *   console_log          — remove the matched console.METHOD() call line
 *   any_type             — replace `: any` with `: unknown` at the issue line
 *   todo_comment         — remove the TODO/FIXME/HACK comment line
 *   empty_catch          — expand single-line empty catch with a void comment
 *   non_null_assertions  — replace first `!.` with `?.` at the issue line
 *   hardcoded_url        — replace hardcoded localhost URL with env var reference
 *
 * Unsupported detector IDs (structural / multi-file — return null):
 *   large_file, large_file_critical, n_plus_one_query, db_select_all,
 *   unhandled_promise, wildcard_import, hardcoded_credential
 *
 * HARD RULES:
 * ─ NO AI calls. NO internet. NO filesystem writes.
 * ─ File reads are strictly read-only (fs.readFileSync).
 * ─ Returns null when a real patch cannot be safely produced.
 * ─ All generated patches reference REAL code from the REAL BitZimi project.
 */

import * as fs from "fs";
import * as path from "path";
import type { Finding } from "../scanners/issueDetectors";
import type { DevIssue } from "../scanners/issueBuilder";
import type {
  PatchProposal,
  PatchFile,
  PatchDiffLine,
  PatchRiskAssessment,
  ExplainFix,
  PatchComplexity,
  PatchRiskLevel,
} from "./patchTypes";

// ─── Detectors that produce real patches ─────────────────────────────────────

const PATCHABLE = new Set([
  "console_log",
  "any_type",
  "todo_comment",
  "empty_catch",
  "non_null_assertions",
  "hardcoded_url",
]);

// ─── Counter (reset-safe across reloads) ─────────────────────────────────────

let patchCounter = 0;

export function resetPatchCounter(): void {
  patchCounter = 0;
}

function nextPatchId(): string {
  patchCounter++;
  return `PAT-${String(patchCounter).padStart(4, "0")}`;
}

// ─── Diff builder ─────────────────────────────────────────────────────────────

interface LineEdit {
  targetLine: number;   // 1-indexed line number in original file
  removedLines: string[];
  addedLines: string[];
}

function buildDiff(
  lines: string[],
  edit: LineEdit,
  contextCount = 3,
): { diff: PatchDiffLine[]; linesAdded: number; linesRemoved: number } {
  const { targetLine, removedLines, addedLines } = edit;
  const result: PatchDiffLine[] = [];

  // Clamp context window
  const ctxStart     = Math.max(0, targetLine - 1 - contextCount);
  const editEndBefore = targetLine - 1 + removedLines.length;
  const ctxEnd       = Math.min(lines.length, editEndBefore + contextCount);

  // Hunk header counts
  const hunkBeforeStart  = ctxStart + 1;
  const hunkBeforeCount  = (targetLine - 1 - ctxStart) + removedLines.length + (ctxEnd - editEndBefore);
  const hunkAfterCount   = (targetLine - 1 - ctxStart) + addedLines.length + (ctxEnd - editEndBefore);

  result.push({
    type: "hunk",
    lineNumBefore: null,
    lineNumAfter: null,
    content: `@@ -${hunkBeforeStart},${hunkBeforeCount} +${hunkBeforeStart},${hunkAfterCount} @@`,
  });

  // Context before
  for (let i = ctxStart; i < targetLine - 1; i++) {
    result.push({ type: "unchanged", lineNumBefore: i + 1, lineNumAfter: i + 1, content: lines[i] });
  }

  // Removed lines
  for (let i = 0; i < removedLines.length; i++) {
    result.push({ type: "removed", lineNumBefore: targetLine + i, lineNumAfter: null, content: removedLines[i] });
  }

  // Added lines
  const lineNumOffset = addedLines.length - removedLines.length;
  for (let i = 0; i < addedLines.length; i++) {
    result.push({ type: "added", lineNumBefore: null, lineNumAfter: targetLine + i, content: addedLines[i] });
  }

  // Context after
  for (let i = editEndBefore; i < ctxEnd; i++) {
    result.push({
      type: "unchanged",
      lineNumBefore: i + 1,
      lineNumAfter: i + 1 + lineNumOffset,
      content: lines[i],
    });
  }

  return { diff: result, linesAdded: addedLines.length, linesRemoved: removedLines.length };
}

// ─── File reader ──────────────────────────────────────────────────────────────

function readLines(absolutePath: string): string[] | null {
  try {
    const content = fs.readFileSync(absolutePath, "utf8");
    return content.split("\n");
  } catch {
    return null;
  }
}

// ─── Language detector ────────────────────────────────────────────────────────

function langFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".json": "json", ".css": "css", ".scss": "scss",
    ".md": "markdown", ".html": "html",
  };
  return map[ext] ?? "plaintext";
}

// ─── Risk builder helpers ─────────────────────────────────────────────────────

function buildRisk(
  overall: PatchRiskLevel,
  reason: string,
  confidence: number,
  detectorId: string,
): PatchRiskAssessment {
  const dims: PatchRiskAssessment["dimensions"] = [
    {
      area: "Business Logic",
      level: overall === "very_low" || overall === "low" ? "very_low" : overall,
      reason: "Single-line cosmetic or style change; no control-flow modification.",
    },
    {
      area: "Database",
      level: "very_low",
      reason: "No database queries affected.",
    },
    {
      area: "API",
      level: detectorId === "hardcoded_url" ? "low" : "very_low",
      reason:
        detectorId === "hardcoded_url"
          ? "URL replaced with env var reference; correct env var must be set before deploy."
          : "No API contracts modified.",
    },
    {
      area: "Frontend",
      level: "very_low",
      reason: "No rendered output changed.",
    },
    {
      area: "Backend",
      level: overall,
      reason: reason,
    },
    {
      area: "Security",
      level: detectorId === "hardcoded_url" ? "low" : "very_low",
      reason:
        detectorId === "hardcoded_url"
          ? "Removing hardcoded URL reduces secret exposure. Env var must be provisioned."
          : detectorId === "hardcoded_credential"
          ? "Hardcoded credential removed. Rotation of the exposed secret is still required."
          : "No security surface changed.",
    },
    {
      area: "Performance",
      level: "very_low",
      reason: "No algorithmic changes; no new I/O or computation introduced.",
    },
    {
      area: "Integration",
      level: "very_low",
      reason: "No third-party integrations involved.",
    },
  ];

  return { overall, overallReason: reason, confidence, dimensions: dims };
}

// ─── ExplainFix builders ──────────────────────────────────────────────────────

function explainConsoleLog(issue: DevIssue, matchedText: string | undefined): ExplainFix {
  const method = matchedText?.replace("console.", "").replace("(", "") ?? "log";
  return {
    whyIssueExists:
      "Development debug statements were left in production code. `console." + method + "()` calls " +
      "write to stdout/stderr in Node.js and to the browser console, leaking internal state.",
    whyItHappens:
      "Developers add logging during feature development and omit cleanup before committing. " +
      "Pre-commit hooks or linters that flag console usage were not enforced at this call site.",
    whySolutionWorks:
      "Removing the line eliminates the runtime overhead and information disclosure without " +
      "affecting any program logic — console calls are fire-and-forget with no return value used.",
    possibleSideEffects: [
      "If the console call was the only indication of an error path, that signal is now silent. " +
      "Replace with structured logging (winston, pino) if observability is needed.",
    ],
    possibleAlternatives: [
      "Replace with a structured logger (pino / winston) that respects log levels and is disabled in production.",
      "Wrap in `if (process.env.NODE_ENV !== 'production')` to keep development visibility.",
    ],
    tradeoffs: [
      "Hard removal is the safest change and has zero risk in production.",
      "A structured logger replacement is more maintainable long-term but is a larger change.",
    ],
    dependencies: [issue.file ?? "the file containing the console call"],
    affectedSystems: [issue.module, issue.layer],
    expectedOutcome:
      "The " + method + " statement is removed. No output is produced at this code path. " +
      "Surrounding logic is unchanged.",
  };
}

function explainAnyType(issue: DevIssue): ExplainFix {
  return {
    whyIssueExists:
      "`: any` disables TypeScript's type checker for the annotated variable, defeating type safety " +
      "and hiding potential runtime errors that strict typing would catch at compile time.",
    whyItHappens:
      "Developers reach for `any` when the correct type is complex or unknown. Over time these " +
      "accumulate and make refactoring dangerous because the compiler can no longer track data shapes.",
    whySolutionWorks:
      "Replacing `: any` with `: unknown` preserves the escape hatch semantics but forces an " +
      "explicit type check or cast before the value is used, restoring compiler protection.",
    possibleSideEffects: [
      "If the variable is subsequently used without a type guard, the compiler will now report an error. " +
      "These errors must be resolved — they are pre-existing gaps in type coverage, now surfaced.",
    ],
    possibleAlternatives: [
      "Use the narrowest correct type (e.g. `Record<string, unknown>`, a specific interface, or a union).",
      "Use `as const` assertions where literal types are applicable.",
    ],
    tradeoffs: [
      "`unknown` is safer than `any` and requires explicit narrowing.",
      "The narrowest correct type is ideal but requires deeper analysis of the data contract.",
    ],
    dependencies: [issue.file ?? "the affected file"],
    affectedSystems: [issue.module, issue.layer],
    expectedOutcome:
      "TypeScript will enforce type checks on the annotated value. Downstream usages may require " +
      "type guards. The compiler will surface any pre-existing unsafe usages.",
  };
}

function explainTodoComment(issue: DevIssue, matchedText: string | undefined): ExplainFix {
  const label = matchedText?.substring(0, 20) ?? "TODO";
  return {
    whyIssueExists:
      "TODO/FIXME/HACK/XXX comments are temporary markers that were never resolved. " +
      "They accumulate technical debt and indicate unfinished or workaround code.",
    whyItHappens:
      `"${label}..." was left from a development session. Without automated enforcement ` +
      "these markers often persist indefinitely in the codebase.",
    whySolutionWorks:
      "Removing the comment line eliminates the marker. If the underlying work is still required, " +
      "create a tracked issue in the project tracker before removing the comment.",
    possibleSideEffects: [
      "If the TODO referenced genuine unfinished work, that context is lost. " +
      "Create a GitHub/Jira issue to preserve the intent.",
    ],
    possibleAlternatives: [
      "Resolve the underlying issue the TODO was tracking.",
      "Convert to a tracked issue in the project management system.",
    ],
    tradeoffs: [
      "Removing the comment is the safest code change (zero runtime impact).",
      "The underlying technical debt referenced by the comment may still need addressing.",
    ],
    dependencies: [issue.file ?? "the affected file"],
    affectedSystems: [issue.module],
    expectedOutcome:
      "The comment line is removed. No logic is affected. The codebase metric for TODO density improves.",
  };
}

function explainEmptyCatch(issue: DevIssue): ExplainFix {
  return {
    whyIssueExists:
      "An empty catch block silently swallows errors. Any exception thrown in the try block " +
      "is discarded without logging, rethrowing, or any indication of failure.",
    whyItHappens:
      "Empty catches are often added as quick silencers when an error is expected but not " +
      "handled. They become permanent and hide bugs in production.",
    whySolutionWorks:
      "Adding a void comment inside the block makes the intent explicit: the author chose to " +
      "ignore this error. The comment surfaces the decision in code review and future audits.",
    possibleSideEffects: [
      "No runtime behaviour changes — the error is still silenced. " +
      "Structured logging should replace the comment in production-critical paths.",
    ],
    possibleAlternatives: [
      "Log the error with a structured logger: `logger.warn('Caught expected error', { error: e })`.",
      "Rethrow the error if it is not expected: `throw e`.",
    ],
    tradeoffs: [
      "A comment is the minimal-risk change. Actual logging requires importing a logger.",
      "Rethrowing may change control flow — only safe if callers handle the error.",
    ],
    dependencies: [issue.file ?? "the affected file"],
    affectedSystems: [issue.module, issue.layer],
    expectedOutcome:
      "The catch block contains an explicit acknowledgement. Linters that flag empty catch blocks " +
      "will be satisfied. Runtime behaviour is unchanged.",
  };
}

function explainNonNull(issue: DevIssue): ExplainFix {
  return {
    whyIssueExists:
      "Non-null assertions (`!.`) bypass TypeScript's null safety, telling the compiler " +
      "\"this value is definitely not null or undefined\" without any runtime verification. " +
      "If the assertion is wrong, the code throws a TypeError at runtime.",
    whyItHappens:
      "Developers use `!.` to silence \"possibly undefined\" errors quickly, especially when " +
      "migrating JavaScript to TypeScript or when the null condition is assumed but not proven.",
    whySolutionWorks:
      "Optional chaining (`?.`) evaluates to `undefined` when the value is null/undefined " +
      "rather than throwing. The caller must handle the `undefined` result, but no crash occurs.",
    possibleSideEffects: [
      "Downstream code that expected a non-null value will now receive `undefined`. " +
      "If it passes that value forward, a different error may surface later in the call chain.",
      "Where the non-null assertion was correct, `?.` produces the same value — no change.",
    ],
    possibleAlternatives: [
      "Add an explicit null check before the access: `if (value) { value.property; }`",
      "Use a non-null assertion only when provably safe, with a comment explaining why.",
    ],
    tradeoffs: [
      "`?.` is always safe; `!.` is only safe when provably non-null.",
      "Optional chaining may propagate undefined further up the call chain, requiring null-handling there.",
    ],
    dependencies: [issue.file ?? "the affected file"],
    affectedSystems: [issue.module, issue.layer],
    expectedOutcome:
      "The non-null assertion is replaced with optional chaining. TypeScript will not throw at this " +
      "access site if the value is null. The undefined case must be handled by callers.",
  };
}

function explainHardcodedUrl(issue: DevIssue, matchedText: string | undefined): ExplainFix {
  const url = matchedText ?? "http://localhost:PORT";
  const isBackend = issue.layer === "backend";
  const envVar = isBackend ? "process.env.API_URL" : "import.meta.env.VITE_API_URL";
  return {
    whyIssueExists:
      `The URL "${url}" is hardcoded directly in source code. In production the target ` +
      "host differs from localhost, so the hardcoded value will point to nothing or the wrong service.",
    whyItHappens:
      "The URL was likely correct during local development and was committed before environment " +
      "configuration was established. Without a lint rule for hardcoded URLs, it persisted.",
    whySolutionWorks:
      `Replacing the literal with \`${envVar}\` reads the URL from the deployment environment ` +
      "at runtime, allowing each environment (dev, staging, production) to inject its own value.",
    possibleSideEffects: [
      `The environment variable \`${isBackend ? "API_URL" : "VITE_API_URL"}\` must be set in all ` +
      "deployment environments or the value will be undefined at runtime.",
      "Local development requires the variable in .env (already present if the service runs correctly now).",
    ],
    possibleAlternatives: [
      "Use a centralised config module that reads from environment variables and exports typed constants.",
      "For backend, use a validated config schema (zod + dotenv) to fail fast on missing env vars.",
    ],
    tradeoffs: [
      "Direct env var reference is minimal-change and immediately deployable.",
      "A centralised config module is more maintainable but is a larger refactor.",
    ],
    dependencies: [
      issue.file ?? "the affected file",
      isBackend ? ".env / deployment environment (API_URL)" : ".env / deployment environment (VITE_API_URL)",
    ],
    affectedSystems: [issue.module, issue.layer],
    expectedOutcome:
      `The hardcoded URL "${url}" is replaced with ${envVar}. ` +
      "The service will use the correct URL in each deployment environment.",
  };
}

// ─── Individual patch strategies ──────────────────────────────────────────────

function patchConsoleLog(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // Sanity-check: line must contain console.
  if (!originalLine.includes("console.")) return null;

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: [],
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  return {
    id: patchId,
    issueId: issue.id,
    title: `Remove debug console statement in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `A \`${finding.matchedText ?? "console.log("}\` call on line ${targetLine} of ` +
      `${issue.file} produces output in production. Removing the line eliminates the ` +
      "information disclosure and the runtime overhead.",
    proposedSolution:
      `Delete line ${targetLine}: \`${originalLine.trim()}\`. No other changes are needed.`,
    expectedResult:
      "The console statement is removed. No output is produced at this code path. " +
      "All surrounding logic remains unchanged.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: 0,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "very_low",
      "Removes a single debug statement with no return value and no side effects on surrounding logic.",
      issue.confidence ?? finding.confidence,
      "console_log",
    ),
    explainFix: explainConsoleLog(issue, finding.matchedText),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

function patchAnyType(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // Find first `: any` or `<any` or `as any` occurrence on the line
  let replaced: string | null = null;
  if (originalLine.includes(": any")) {
    replaced = originalLine.replace(": any", ": unknown");
  } else if (originalLine.includes("as any")) {
    replaced = originalLine.replace("as any", "as unknown");
  } else if (originalLine.includes("<any>")) {
    replaced = originalLine.replace("<any>", "<unknown>");
  }

  if (!replaced || replaced === originalLine) return null;

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: [replaced],
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  return {
    id: patchId,
    issueId: issue.id,
    title: `Replace \`any\` type with \`unknown\` in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `Line ${targetLine} of ${issue.file} uses the \`any\` type, bypassing TypeScript's ` +
      "type checker. Replacing with `unknown` restores compiler protection while " +
      "preserving the escape hatch semantics.",
    proposedSolution:
      `On line ${targetLine}, replace \`${originalLine.trim()}\` with ` +
      `\`${replaced.trim()}\`. Downstream usages may require a type guard or cast.`,
    expectedResult:
      "TypeScript enforces type safety at this site. Any pre-existing unsafe usages " +
      "of the value will surface as compiler errors to be resolved.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: 1,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "low",
      "Replaces `any` with `unknown` at one annotation site. Downstream usages that were implicitly " +
      "unsafe will now require explicit type guards — surfacing pre-existing issues.",
      issue.confidence ?? finding.confidence,
      "any_type",
    ),
    explainFix: explainAnyType(issue),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

function patchTodoComment(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // Sanity-check: must contain a TODO-style marker
  if (!/\/\/\s*(TODO|FIXME|HACK|XXX|BUG|TEMP)/i.test(originalLine)) return null;

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: [],
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  const marker = (originalLine.match(/\/\/\s*(TODO|FIXME|HACK|XXX|BUG|TEMP)/i) ?? [])[1]?.toUpperCase() ?? "TODO";

  return {
    id: patchId,
    issueId: issue.id,
    title: `Remove ${marker} comment in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `Line ${targetLine} of ${issue.file} contains an unresolved ${marker} comment: ` +
      `"${(finding.matchedText ?? originalLine.trim()).substring(0, 60)}…". ` +
      "Removing the comment reduces technical debt markers. Create a tracked issue " +
      "if the underlying work still needs completing.",
    proposedSolution:
      `Delete line ${targetLine}: \`${originalLine.trim().substring(0, 80)}\`. ` +
      "If the TODO refers to real pending work, create a project tracker issue first.",
    expectedResult:
      "The comment line is removed. No logic is affected. The TODO debt counter decreases by one.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: 0,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "very_low",
      "Removes a comment line with zero runtime impact.",
      issue.confidence ?? finding.confidence,
      "todo_comment",
    ),
    explainFix: explainTodoComment(issue, finding.matchedText),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

function patchEmptyCatch(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // Only handle single-line empty catch: `catch (...) {}` or `catch (...) { }`
  const singleLineCatch = /(\}\s*catch\s*\([^)]*\)\s*\{)\s*\}/.exec(originalLine);
  if (!singleLineCatch) return null;

  // Detect indentation of the catch line
  const indentMatch = /^(\s*)/.exec(originalLine);
  const indent = indentMatch ? indentMatch[1] : "";
  const innerIndent = indent + "  ";

  // Build replacement: split the catch body across three lines
  const catchOpen = singleLineCatch[1]; // e.g. `} catch (err) {`
  const prefixBeforeCatch = originalLine.slice(0, singleLineCatch.index);

  const newLines = [
    prefixBeforeCatch + catchOpen,
    innerIndent + "// Error intentionally suppressed — add structured logging if observability is needed",
    indent + "}",
  ];

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: newLines,
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  return {
    id: patchId,
    issueId: issue.id,
    title: `Expand empty catch block in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `An empty catch block on line ${targetLine} of ${issue.file} silently discards ` +
      "all exceptions. Adding a void comment makes the intent explicit and satisfies " +
      "linter rules that flag empty catch blocks.",
    proposedSolution:
      `Expand the single-line \`catch (...) {}\` into a three-line form containing an ` +
      "explanatory comment. No control-flow changes.",
    expectedResult:
      "The catch block explicitly acknowledges the suppressed error. Linters are satisfied. " +
      "Runtime behaviour is unchanged — the error is still suppressed.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: newLines.length,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "very_low",
      "Expands a single-line empty catch into three lines with a comment. Zero runtime impact.",
      issue.confidence ?? finding.confidence,
      "empty_catch",
    ),
    explainFix: explainEmptyCatch(issue),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

function patchNonNullAssertion(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // Replace first `!.` with `?.` — very specific pattern unlikely to collide
  if (!originalLine.includes("!.")) return null;

  const replaced = originalLine.replace("!.", "?.");

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: [replaced],
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  return {
    id: patchId,
    issueId: issue.id,
    title: `Replace non-null assertion with optional chaining in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `Line ${targetLine} of ${issue.file} uses a non-null assertion (\`!.\`) that ` +
      "throws a TypeError if the value is null at runtime. Replacing with optional " +
      "chaining (\`?.\`) makes the null case safe.",
    proposedSolution:
      `Replace \`!.\` with \`?.\` on line ${targetLine}. ` +
      "Verify that callers handle a potential `undefined` result.",
    expectedResult:
      "A null/undefined value at this access site will evaluate to `undefined` instead of " +
      "throwing a TypeError. Callers must handle the `undefined` case.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: 1,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "low",
      "Replaces a crash-prone assertion with safe optional chaining. " +
      "If the assertion was correct, behaviour is unchanged. " +
      "If it was incorrect, the crash is now prevented — downstream code sees `undefined`.",
      issue.confidence ?? finding.confidence,
      "non_null_assertions",
    ),
    explainFix: explainNonNull(issue),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

function patchHardcodedUrl(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
  patchId: string,
): PatchProposal | null {
  if (!issue.file || !issue.line) return null;

  const absolutePath = path.join(projectRoot, issue.file);
  const lines = readLines(absolutePath);
  if (!lines || issue.line > lines.length) return null;

  const targetLine = issue.line;
  const originalLine = lines[targetLine - 1];

  // finding.matchedText is the URL string (without surrounding quotes)
  const matchedUrl = finding.matchedText;
  if (!matchedUrl) return null;

  // Determine which env var to use
  const isBackend = issue.layer === "backend";
  const envExpr = isBackend
    ? `process.env.API_URL ?? "${matchedUrl}"`
    : `(import.meta as any).env?.VITE_API_URL ?? "${matchedUrl}"`;

  // Replace the URL in the line (look for it in quotes)
  const quotePatterns = [
    { from: `"${matchedUrl}"`, to: `\`\${${isBackend ? "process.env.API_URL" : "(import.meta as any).env?.VITE_API_URL"} ?? "${matchedUrl}"}\`` },
    { from: `'${matchedUrl}'`, to: `\`\${${isBackend ? "process.env.API_URL" : "(import.meta as any).env?.VITE_API_URL"} ?? "${matchedUrl}"}\`` },
    { from: `\`${matchedUrl}\``, to: `\`\${${isBackend ? "process.env.API_URL" : "(import.meta as any).env?.VITE_API_URL"} ?? "${matchedUrl}"}\`` },
  ];

  let replaced: string | null = null;
  for (const pattern of quotePatterns) {
    if (originalLine.includes(pattern.from)) {
      replaced = originalLine.replace(pattern.from, pattern.to);
      break;
    }
  }

  // Fallback: replace the URL literal directly
  if (!replaced && originalLine.includes(matchedUrl)) {
    replaced = originalLine.replace(matchedUrl, `\${${envExpr}}`);
  }

  if (!replaced || replaced === originalLine) return null;

  const { diff, linesAdded, linesRemoved } = buildDiff(lines, {
    targetLine,
    removedLines: [originalLine],
    addedLines: [replaced],
  });

  const patchFile: PatchFile = {
    filePath: issue.file,
    language: langFromPath(issue.file),
    diff,
    linesAdded,
    linesRemoved,
  };

  const envVarName = isBackend ? "API_URL" : "VITE_API_URL";

  return {
    id: patchId,
    issueId: issue.id,
    title: `Replace hardcoded URL with env var in ${path.basename(issue.file)}:${targetLine}`,
    severity: issue.severity,
    confidence: issue.confidence ?? finding.confidence,
    affectedLayer: issue.layer,
    affectedModule: issue.module,
    affectedFile: issue.file,
    affectedFolder: path.dirname(issue.file),
    affectedLine: targetLine,
    rootCause: issue.rootCause,
    summary:
      `The URL "${matchedUrl}" is hardcoded on line ${targetLine} of ${issue.file}. ` +
      `It will be wrong in all non-localhost environments. Replacing with ` +
      `\`${envVarName}\` makes the URL environment-aware.`,
    proposedSolution:
      `Replace the literal "${matchedUrl}" with the environment variable ` +
      `\`${envVarName}\` (falling back to the original URL for local development). ` +
      `Set \`${envVarName}\` in all deployment environments.`,
    expectedResult:
      `The URL is read from \`${envVarName}\` at runtime. Production deployments use ` +
      "the correct host without a code change. Local development continues to use the localhost fallback.",
    estimatedComplexity: "trivial",
    totalFilesAffected: 1,
    totalLinesAdded: 1,
    totalLinesRemoved: 1,
    files: [patchFile],
    riskAssessment: buildRisk(
      "low",
      `URL replaced with env var reference. The env var \`${envVarName}\` must be ` +
      "provisioned in all deployment environments or the value will be undefined.",
      issue.confidence ?? finding.confidence,
      "hardcoded_url",
    ),
    explainFix: explainHardcodedUrl(issue, matchedUrl),
    approvalStatus: "pending_review",
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    generatedAt: new Date().toISOString(),
    generatedBy: "patch-engine-v14.3",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * generatePatch — produce a real PatchProposal from a scanned issue + its finding.
 *
 * Returns null for unsupported detector IDs or when the file cannot be safely patched.
 * Never throws — returns null on any internal error.
 */
export function generatePatch(
  issue: DevIssue,
  finding: Finding,
  projectRoot: string,
): PatchProposal | null {
  if (!PATCHABLE.has(finding.detectorId)) return null;

  const patchId = nextPatchId();

  try {
    switch (finding.detectorId) {
      case "console_log":        return patchConsoleLog(issue, finding, projectRoot, patchId);
      case "any_type":           return patchAnyType(issue, finding, projectRoot, patchId);
      case "todo_comment":       return patchTodoComment(issue, finding, projectRoot, patchId);
      case "empty_catch":        return patchEmptyCatch(issue, finding, projectRoot, patchId);
      case "non_null_assertions": return patchNonNullAssertion(issue, finding, projectRoot, patchId);
      case "hardcoded_url":      return patchHardcodedUrl(issue, finding, projectRoot, patchId);
      default:                   return null;
    }
  } catch {
    return null;
  }
}

/**
 * isPatchable — true if this detectorId can produce a real patch.
 */
export function isPatchable(detectorId: string): boolean {
  return PATCHABLE.has(detectorId);
}
