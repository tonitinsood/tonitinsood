import assert from "node:assert/strict";
import test from "node:test";
import {
  cellIsTruncationOnly,
  FULL_PITCH_CELL_MAX,
  pitchesTabFullPitchCell,
  SHEETS_CELL_CHAR_MAX,
  splitTextForSheetCells,
} from "./sheet-cells.js";

test("short pitch stays whole on Pitches; no FullText parts", () => {
  const pitch = "Buy 7203.T. The shares are undervalued versus the parts.";
  const { cell, parts } = pitchesTabFullPitchCell(pitch, "row-1");
  assert.equal(cell, pitch);
  assert.deepEqual(parts, []);
  assert.equal(cellIsTruncationOnly(cell), false);
});

test("long pitch: excerpt is real text plus FullText pointer; parts cover the whole pitch", () => {
  const pitch = "THESIS ".repeat(20_000); // ~140k chars
  const { cell, parts } = pitchesTabFullPitchCell(pitch, "abc-uuid");
  assert.ok(cell.startsWith("THESIS "));
  assert.ok(cell.includes("Complete pitch is in the FullText tab"));
  assert.ok(cell.includes("abc-uuid"));
  assert.ok(!/^\[truncated/i.test(cell.trim()));
  assert.ok(cell.length <= SHEETS_CELL_CHAR_MAX);
  assert.ok(parts.length >= 2);
  const joined = parts.map((p) => p.replace(/^\[part \d+\/\d+\]\n/, "")).join("");
  assert.equal(joined, pitch);
  assert.ok(joined.length > FULL_PITCH_CELL_MAX);
});

test("splitTextForSheetCells prefixes parts and stays under the cell cap", () => {
  const text = "x".repeat(SHEETS_CELL_CHAR_MAX + 10);
  const parts = splitTextForSheetCells(text);
  assert.ok(parts.length >= 2);
  for (const part of parts) {
    assert.ok(part.length <= SHEETS_CELL_CHAR_MAX);
  }
});
