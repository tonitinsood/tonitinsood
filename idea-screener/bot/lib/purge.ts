import type { PitchRow } from "./types.js";

const RETENTION_DAYS = 7;

export function rowsEligibleForPurge(
  rows: PitchRow[],
  rowNumbers: number[],
  now: Date,
): number[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toDelete: number[] = [];
  rows.forEach((row, idx) => {
    if (row.shortlisted || row.archived) return;
    const discovered = Date.parse(row.discovered_at);
    if (Number.isNaN(discovered)) return;
    if (discovered < cutoff) {
      toDelete.push(rowNumbers[idx]!);
    }
  });
  return toDelete;
}
