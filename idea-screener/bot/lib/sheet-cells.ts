/** Google Sheets hard limit per cell. */
export const SHEETS_CELL_CHAR_MAX = 50_000;

/** Keep a readable excerpt on Pitches; the rest lives on FullText. */
export const FULL_PITCH_CELL_MAX = 45_000;

const PART_HEADER_RESERVE = 40;

export function fullTextPointer(rowId: string, partCount: number): string {
  const parts =
    partCount <= 1 ? "1 part" : `parts 1–${partCount}`;
  return `\n\n---\nComplete pitch is in the FullText tab (${parts}, row_id ${rowId}). This cell is an excerpt; nothing was dropped.`;
}

/** Clamp text so the result fits in one Sheets cell (including optional suffix). */
export function truncateToSheetCell(text: string, suffix = ""): string {
  const max = SHEETS_CELL_CHAR_MAX;
  if (text.length + suffix.length <= max) {
    return suffix ? text + suffix : text;
  }
  const bodyMax = Math.max(0, max - suffix.length);
  return text.slice(0, bodyMax) + suffix;
}

/**
 * Split long text into multiple cell-safe chunks for the FullText tab.
 * Multi-part rows repeat `row_id`; each cell is prefixed with `[part i/n]`.
 */
export function splitTextForSheetCells(text: string): string[] {
  if (text.length <= SHEETS_CELL_CHAR_MAX) return [text];

  const bodyMax = SHEETS_CELL_CHAR_MAX - PART_HEADER_RESERVE;
  const raw: string[] = [];
  for (let i = 0; i < text.length; i += bodyMax) {
    raw.push(text.slice(i, i + bodyMax));
  }
  const n = raw.length;
  return raw.map((chunk, i) => {
    const header = n > 1 ? `[part ${i + 1}/${n}]\n` : "";
    return header + chunk;
  });
}

export type PitchesPitchCell = {
  /** Readable excerpt (or the full pitch if it fits). Never "[truncated]" alone. */
  cell: string;
  /** Complete pitch, split for FullText. Empty when the Pitches cell holds everything. */
  parts: string[];
};

/**
 * Pitches tab shows a readable excerpt plus a pointer to FullText parts
 * when the complete pitch is longer than one cell.
 */
export function pitchesTabFullPitchCell(
  fullPitch: string,
  rowId: string,
): PitchesPitchCell {
  const text = fullPitch ?? "";
  if (!text.trim()) {
    return { cell: "", parts: [] };
  }
  if (text.length <= FULL_PITCH_CELL_MAX) {
    return { cell: text, parts: [] };
  }
  const parts = splitTextForSheetCells(text);
  const pointer = fullTextPointer(rowId, parts.length);
  const excerptMax = Math.min(
    FULL_PITCH_CELL_MAX,
    SHEETS_CELL_CHAR_MAX - pointer.length,
  );
  const excerpt = text.slice(0, Math.max(1, excerptMax));
  return { cell: excerpt + pointer, parts };
}

export function cellIsTruncationOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^\[truncated[^\]]*\]$/i.test(t);
}
