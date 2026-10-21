import type { PitchRow } from "./types.js";

/** Header row for the `Pitches` tab. */
export const PITCH_HEADERS: (keyof PitchRow)[] = [
  "row_id",
  "date",
  "discovered_at",
  "source_type",
  "source_name",
  "pitched_by",
  "ticker",
  "exchange_country",
  "company",
  "thesis_short",
  "full_pitch",
  "pe",
  "ev_ebit",
  "roic",
  "net_debt_ebitda",
  "metrics_source",
  "source_url",
  "shortlisted",
  "archived",
  "notes",
];

export const PITCHES_TAB = "Pitches";
export const FULL_TEXT_TAB = "FullText";
export const SHEET_TITLE = "Stock Idea Screener";

/** Google Sheets cell limit (~50k); overflow longer text to `FullText`. */
export const FULL_PITCH_CELL_MAX = 45000;
