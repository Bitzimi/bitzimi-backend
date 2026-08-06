/**
 * Patch Store — Phase 14.3
 *
 * In-memory store for generated PatchProposals and their audit history.
 * Keyed by patchId and by issueId for O(1) lookup in both directions.
 *
 * Lifecycle states:
 *   generated → pending_review → approved → (applied via Fix Engine)
 *                              → rejected
 *
 * HARD RULES:
 * ─ NO filesystem writes.
 * ─ Only approved patches may transition to "applied" via the Fix Engine.
 * ─ Every state change is recorded in patchHistory.
 */

import type { PatchProposal, PatchHistoryEntry } from "./patchTypes";

// ─── In-memory stores ─────────────────────────────────────────────────────────

const byPatchId  = new Map<string, PatchProposal>();
const byIssueId  = new Map<string, string>();       // issueId → patchId
const history    = new Array<PatchHistoryEntry>();

let historyCounter = 0;

function nextHistoryId(): string {
  historyCounter++;
  return `PHIST-${String(historyCounter).padStart(4, "0")}`;
}

function recordHistory(
  patchId: string,
  issueId: string,
  action: PatchHistoryEntry["action"],
  performedBy: string,
  detail: string | null = null,
): void {
  history.push({
    id:          nextHistoryId(),
    patchId,
    issueId,
    action,
    performedBy,
    performedAt: new Date().toISOString(),
    detail,
  });
}

// ─── Store operations ─────────────────────────────────────────────────────────

/**
 * Store a newly-generated patch. Overwrites any existing patch for the same issueId.
 */
export function storePatch(patch: PatchProposal): void {
  // If there was a previous patch for this issue, remove it
  const existing = byIssueId.get(patch.issueId);
  if (existing) {
    byPatchId.delete(existing);
  }
  byPatchId.set(patch.id, patch);
  byIssueId.set(patch.issueId, patch.id);
  recordHistory(patch.id, patch.issueId, "generated", patch.generatedBy, null);
}

/**
 * Retrieve a patch by its patchId.
 */
export function getPatchById(patchId: string): PatchProposal | null {
  return byPatchId.get(patchId) ?? null;
}

/**
 * Retrieve the latest patch for a given issueId.
 */
export function getPatchByIssueId(issueId: string): PatchProposal | null {
  const patchId = byIssueId.get(issueId);
  if (!patchId) return null;
  return byPatchId.get(patchId) ?? null;
}

/**
 * Approve a patch. Returns the updated proposal or null if not found.
 */
export function approvePatch(patchId: string, approvedBy: string): PatchProposal | null {
  const patch = byPatchId.get(patchId);
  if (!patch) return null;

  const updated: PatchProposal = {
    ...patch,
    approvalStatus: "approved",
    approvedBy,
    approvedAt: new Date().toISOString(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };
  byPatchId.set(patchId, updated);
  recordHistory(patchId, patch.issueId, "approved", approvedBy, null);
  return updated;
}

/**
 * Reject a patch. Returns the updated proposal or null if not found.
 */
export function rejectPatch(
  patchId: string,
  rejectedBy: string,
  reason: string,
): PatchProposal | null {
  const patch = byPatchId.get(patchId);
  if (!patch) return null;

  const updated: PatchProposal = {
    ...patch,
    approvalStatus: "rejected",
    rejectedBy,
    rejectedAt: new Date().toISOString(),
    rejectionReason: reason,
    approvedBy: null,
    approvedAt: null,
  };
  byPatchId.set(patchId, updated);
  recordHistory(patchId, patch.issueId, "rejected", rejectedBy, reason);
  return updated;
}

/**
 * Record that a patch was applied (called by the Fix Engine workflow).
 */
export function recordPatchApplied(patchId: string, appliedBy: string): void {
  const patch = byPatchId.get(patchId);
  if (!patch) return;
  recordHistory(patchId, patch.issueId, "applied", appliedBy, null);
}

/**
 * Return all patches (sorted newest first by generatedAt).
 */
export function getAllPatches(): PatchProposal[] {
  return [...byPatchId.values()].sort(
    (a, b) => b.generatedAt.localeCompare(a.generatedAt),
  );
}

/**
 * Return full patch history (newest first).
 */
export function getPatchHistory(): { items: PatchHistoryEntry[]; total: number } {
  const items = [...history].sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  return { items, total: items.length };
}

/**
 * Clear all patch data (used when a new scan replaces the issue set).
 */
export function clearPatches(): void {
  byPatchId.clear();
  byIssueId.clear();
  // History is intentionally preserved across scans
}
