/**
 * Patch Validator — Phase 14.3
 *
 * Pre-apply validation for PatchProposals. Checks that:
 *   - All affected files still exist on disk
 *   - Affected line numbers are still within the file's current line count
 *   - The before-content in the diff still matches the current file content
 *   - The patch is approved before validation is attempted
 *
 * HARD RULES:
 * ─ Read-only filesystem access (fs.readFileSync only).
 * ─ NO filesystem writes.
 * ─ Returns a PatchValidationResult — never throws.
 */

import * as fs from "fs";
import * as path from "path";
import type { PatchProposal, PatchValidationResult } from "./patchTypes";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * validatePatch — verify a PatchProposal against the current state of the filesystem.
 *
 * Must be called before applying a patch to ensure the diff is still applicable.
 * Returns a full validation report including per-file checks.
 */
export function validatePatch(
  patch: PatchProposal,
  projectRoot: string,
): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileChecks: PatchValidationResult["fileChecks"] = [];

  // Guard: patch must be approved
  if (patch.approvalStatus !== "approved") {
    errors.push(
      `Patch ${patch.id} has approval status "${patch.approvalStatus}". ` +
      "Only approved patches may be applied.",
    );
  }

  // Guard: must have at least one file
  if (!patch.files || patch.files.length === 0) {
    errors.push(`Patch ${patch.id} has no file changes defined.`);
    return { valid: false, errors, warnings, fileChecks };
  }

  for (const patchFile of patch.files) {
    const absolutePath = path.join(projectRoot, patchFile.filePath);
    const check: PatchValidationResult["fileChecks"][number] = {
      filePath: patchFile.filePath,
      exists: false,
      lineCountMatch: false,
      hashMatch: false,
      error: null,
    };

    // Check 1: file exists
    if (!fs.existsSync(absolutePath)) {
      check.error = `File not found: ${patchFile.filePath}`;
      errors.push(check.error);
      fileChecks.push(check);
      continue;
    }

    check.exists = true;

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      check.error = `Cannot read file ${patchFile.filePath}: ${msg}`;
      errors.push(check.error);
      fileChecks.push(check);
      continue;
    }

    const lines = content.split("\n");

    // Check 2: the removed lines in the diff still match the current file
    const removedLines = patchFile.diff
      .filter((d) => d.type === "removed")
      .map((d) => ({ lineNum: d.lineNumBefore, content: d.content }));

    let allRemovedMatch = true;
    for (const removed of removedLines) {
      if (removed.lineNum == null) continue;
      const lineIdx = removed.lineNum - 1;
      if (lineIdx >= lines.length) {
        check.error =
          `Line ${removed.lineNum} no longer exists in ${patchFile.filePath} ` +
          `(file now has ${lines.length} lines). File may have been modified since the patch was generated.`;
        errors.push(check.error);
        allRemovedMatch = false;
        break;
      }

      const currentLine = lines[lineIdx];
      if (currentLine !== removed.content) {
        // Allow whitespace-normalised match as a warning
        if (currentLine.trim() !== removed.content.trim()) {
          check.error =
            `Line ${removed.lineNum} content mismatch in ${patchFile.filePath}. ` +
            `Expected: "${removed.content.substring(0, 80)}" ` +
            `Found: "${currentLine.substring(0, 80)}". ` +
            "The file may have been modified since the patch was generated.";
          errors.push(check.error);
          allRemovedMatch = false;
          break;
        } else {
          warnings.push(
            `Line ${removed.lineNum} of ${patchFile.filePath}: whitespace differs from expected. ` +
            "Patch will still apply (content matches after trimming).",
          );
        }
      }
    }

    check.lineCountMatch = allRemovedMatch;
    check.hashMatch = allRemovedMatch;

    fileChecks.push(check);
  }

  // Final warnings for large diffs
  const totalChanged = patch.totalLinesAdded + patch.totalLinesRemoved;
  if (totalChanged > 50) {
    warnings.push(
      `This patch touches ${totalChanged} lines. Review each changed line carefully before applying.`,
    );
  }

  if (patch.riskAssessment.overall === "high" || patch.riskAssessment.overall === "critical") {
    warnings.push(
      `Patch risk level is "${patch.riskAssessment.overall}". ` +
      "Ensure a rollback plan is in place before applying.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileChecks,
  };
}
