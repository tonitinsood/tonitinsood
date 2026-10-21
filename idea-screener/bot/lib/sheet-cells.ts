/** Google Sheets hard limit per cell. */
export const SHEETS_CELL_CHAR_MAX = 50_000;

export const TRUNCATED_SEE_SOURCE_SUFFIX = "[truncated — see source_url]";
export const TRUNCATED_SEE_FULLTEXT_SUFFIX = "… [see FullText tab]";

const PART_HEADER_RESERVE = 32;

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
