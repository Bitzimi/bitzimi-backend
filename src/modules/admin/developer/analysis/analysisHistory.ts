/**
 * Analysis History — Phase 14.2
 *
 * In-memory store for analysis run records. Every enrichment pipeline
 * execution records an AnalysisRecord here.
 *
 * Phase 14.3 wires this to the PersistenceRegistry for cross-session storage.
 * All data is session-scoped in-memory for Phase 14.2.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalysisRecord {
  id:                   string;    // ANA-XXXX
  scanId:               string;
  timestamp:            string;
  filesAnalysed:        number;
  modulesAnalysed:      string[];
  dependenciesAnalysed: number;
  issuesAnalysed:       number;
  durationMs:           number;
  analysisVersion:      string;
  scannerVersion:       string;
  graphNodeCount:       number;
  graphEdgeCount:       number;
}

// ─── Session-scoped store ─────────────────────────────────────────────────────

const store: AnalysisRecord[] = [];
let counter = 0;

// ─── Service ──────────────────────────────────────────────────────────────────

export function recordAnalysis(params: Omit<AnalysisRecord, "id">): AnalysisRecord {
  counter++;
  const record: AnalysisRecord = {
    id: `ANA-${String(counter).padStart(4, "0")}`,
    ...params,
  };
  store.unshift(record);      // newest first
  return record;
}

export function getAnalysisHistory(): AnalysisRecord[] {
  return [...store];
}

export function getLatestAnalysis(): AnalysisRecord | null {
  return store[0] ?? null;
}
