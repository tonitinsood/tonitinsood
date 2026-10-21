import type { ToolContext } from "@cursor/bdk";
import type { sheets_v4 } from "googleapis";
import {
  FULL_TEXT_TAB,
  PITCHES_TAB,
  PITCH_HEADERS,
  SHEET_TITLE,
} from "./columns.js";
import {
  pitchesTabFullPitchCell,
  splitTextForSheetCells,
  truncateToSheetCell,
} from "./sheet-cells.js";
import { sheetsClient } from "./google-auth.js";
import { KV, kvGet, kvPut } from "./kv.js";
import type { PitchRow } from "./types.js";

/** Spreadsheet ID from env (`Google_Sheet_Id` or `GOOGLE_SHEET_ID`). Accepts raw ID or a Sheets URL. */
export function spreadsheetIdFromEnv(): string | undefined {
  const raw =
    process.env.Google_Sheet_Id?.trim() ||
    process.env.GOOGLE_SHEET_ID?.trim();
  if (!raw) return undefined;
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (fromUrl?.[1] ?? raw).trim() || undefined;
}

/**
 * Resolve spreadsheet: env → KV → create (live only).
 * Persists env/KV-discovered id into KV for later tools and hosted runs.
 */
export async function resolveOrCreateSpreadsheetId(
  ctx: Pick<ToolContext, "host">,
  dryRun: boolean,
): Promise<string | undefined> {
  const fromEnv = spreadsheetIdFromEnv();
  if (fromEnv) {
    await kvPut(ctx, KV.sheetId, fromEnv);
    return fromEnv;
  }
  const fromKv = await kvGet<string>(ctx, KV.sheetId);
  if (fromKv) return fromKv;
  if (dryRun) return undefined;
  const created = await createMasterSpreadsheet();
  await kvPut(ctx, KV.sheetId, created);
  return created;
}

/** Prevent USER_ENTERED from treating pitch text as a formula. */
function safeCell(s: string): string {
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function rowToValues(row: PitchRow): string[] {
  return PITCH_HEADERS.map((key) => {
    const v = row[key];
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    const s = v ?? "";
    if (typeof s === "string") {
      return safeCell(truncateToSheetCell(s));
    }
    return safeCell(String(s));
  });
}

function parseBool(cell: string | undefined): boolean {
  if (!cell) return false;
  const s = cell.trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES" || s === "CHECKED";
}

function valuesToRow(values: string[]): PitchRow {
  const map = Object.fromEntries(
    PITCH_HEADERS.map((h, i) => [h, values[i] ?? ""]),
  ) as Record<keyof PitchRow, string>;
  return {
    row_id: map.row_id,
    date: map.date,
    discovered_at: map.discovered_at,
    source_type: map.source_type as PitchRow["source_type"],
    source_name: map.source_name,
    pitched_by: map.pitched_by ?? "",
    ticker: map.ticker,
    exchange_country: map.exchange_country,
    company: map.company,
    thesis_short: map.thesis_short,
    full_pitch: map.full_pitch,
    pe: map.pe,
    ev_ebit: map.ev_ebit,
    roic: map.roic,
    net_debt_ebitda: map.net_debt_ebitda,
    metrics_source: map.metrics_source as PitchRow["metrics_source"],
    source_url: map.source_url,
    shortlisted: parseBool(map.shortlisted as unknown as string),
    archived: parseBool(map.archived as unknown as string),
    notes: map.notes,
  };
}

export async function createMasterSpreadsheet(): Promise<string> {
  const sheets = await sheetsClient();
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_TITLE },
      sheets: [
        { properties: { title: PITCHES_TAB } },
        {
          properties: { title: FULL_TEXT_TAB },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: [
                    { userEnteredValue: { stringValue: "row_id" } },
                    { userEnteredValue: { stringValue: "full_pitch" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const id = created.data.spreadsheetId;
  if (!id) throw new Error("Failed to create spreadsheet");
  await ensureSpreadsheetLayout(id);
  return id;
}

export async function ensurePitchHeaders(spreadsheetId: string): Promise<void> {
  const sheets = await sheetsClient();
  const headerRange = `${PITCHES_TAB}!A1:${colLetter(PITCH_HEADERS.length)}1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });
  const row = (res.data.values?.[0] ?? []) as string[];
  const isEmpty =
    row.length === 0 || row.every((c) => !String(c ?? "").trim());
  const expected = PITCH_HEADERS as string[];

  if (isEmpty) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: { values: [expected] },
    });
    return;
  }

  const mismatches: string[] = [];
  expected.forEach((h, i) => {
    const got = String(row[i] ?? "").trim();
    if (got !== h) {
      mismatches.push(
        `column ${i + 1}: expected "${h}", got "${got || "(empty)"}"`,
      );
    }
  });
  if (mismatches.length > 0) {
    throw new Error(
      `Pitches tab row 1 must match the screener headers (or be blank for auto-setup). ${mismatches.slice(0, 4).join("; ")}${mismatches.length > 4 ? "…" : ""}`,
    );
  }
}

async function pitchSheetId(spreadsheetId: string): Promise<number | undefined> {
  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets?.find((s) => s.properties?.title === PITCHES_TAB)
    ?.properties?.sheetId ?? undefined;
}

async function fullTextSheetMeta(
  spreadsheetId: string,
): Promise<{ sheetId: number | undefined; exists: boolean }> {
  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === FULL_TEXT_TAB);
  const rawId = tab?.properties?.sheetId;
  return { sheetId: rawId ?? undefined, exists: Boolean(tab) };
}

export async function ensureFullTextTab(spreadsheetId: string): Promise<void> {
  const sheets = await sheetsClient();
  const { exists } = await fullTextSheetMeta(spreadsheetId);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: FULL_TEXT_TAB } } }],
      },
    });
  }
  const header = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${FULL_TEXT_TAB}!A1:B1`,
  });
  const row = (header.data.values?.[0] ?? []) as string[];
  if (!row[0] || !row[1]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${FULL_TEXT_TAB}!A1:B1`,
      valueInputOption: "RAW",
      requestBody: { values: [["row_id", "full_pitch"]] },
    });
  }
}

/**
 * Real Google Sheets checkboxes (BOOLEAN + showCustomUi) on shortlisted / archived.
 * Existing TRUE/FALSE text is rewritten as boolean values so they render as ticks.
 *
 * Apply only to rows that already have data. BOOLEAN validation on empty rows
 * materializes FALSE checkboxes and inflates the sheet with blank rows.
 */
export async function ensureCheckboxColumns(
  spreadsheetId: string,
  lastDataRow: number,
): Promise<void> {
  const sheets = await sheetsClient();
  const sheetId = await pitchSheetId(spreadsheetId);
  if (sheetId === undefined) return;
  const endRowIndex = Math.max(2, lastDataRow);
  if (endRowIndex <= 1) return;
  const shortlistedCol = PITCH_HEADERS.indexOf("shortlisted");
  const archivedCol = PITCH_HEADERS.indexOf("archived");
  const boolRule = {
    condition: { type: "BOOLEAN" as const },
    strict: true,
    showCustomUi: true,
  };
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex,
              startColumnIndex: shortlistedCol,
              endColumnIndex: shortlistedCol + 1,
            },
            rule: boolRule,
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex,
              startColumnIndex: archivedCol,
              endColumnIndex: archivedCol + 1,
            },
            rule: boolRule,
          },
        },
      ],
    },
  });
}

export async function writeCheckboxValues(
  spreadsheetId: string,
  flags: { rowNumber: number; shortlisted: boolean; archived: boolean }[],
): Promise<void> {
  if (flags.length === 0) return;
  const sheets = await sheetsClient();
  const sheetId = await pitchSheetId(spreadsheetId);
  if (sheetId === undefined) return;
  const shortlistedCol = PITCH_HEADERS.indexOf("shortlisted");
  const requests: sheets_v4.Schema$Request[] = flags.map((f) => ({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: f.rowNumber - 1,
        endRowIndex: f.rowNumber,
        startColumnIndex: shortlistedCol,
        endColumnIndex: shortlistedCol + 2,
      },
      rows: [
        {
          values: [
            { userEnteredValue: { boolValue: f.shortlisted } },
            { userEnteredValue: { boolValue: f.archived } },
          ],
        },
      ],
      fields: "userEnteredValue",
    },
  }));
  const CHUNK = 50;
  for (let i = 0; i < requests.length; i += CHUNK) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests.slice(i, i + CHUNK) },
    });
  }
}

/** Drop trailing rows that have no row_id (usually empty checkbox shells). */
export async function deleteRowsMissingRowId(spreadsheetId: string): Promise<number> {
  const sheets = await sheetsClient();
  const sheetId = await pitchSheetId(spreadsheetId);
  if (sheetId === undefined) return 0;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PITCHES_TAB}!A2:A`,
  });
  const colA = res.data.values ?? [];
  let firstEmpty = -1;
  for (let i = 0; i < colA.length; i++) {
    const rid = String(colA[i]?.[0] ?? "").trim();
    if (!rid) {
      if (firstEmpty < 0) firstEmpty = i;
    } else if (firstEmpty >= 0) {
      firstEmpty = -1;
    }
  }
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const rowCount =
    meta.data.sheets?.find((s) => s.properties?.title === PITCHES_TAB)
      ?.properties?.gridProperties?.rowCount ?? colA.length + 1;
  // If A is shorter than the grid, trailing rows are also empty.
  const firstMissingIndex = firstEmpty >= 0 ? firstEmpty + 1 : colA.length + 1;
  if (firstMissingIndex >= rowCount) return 0;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: firstMissingIndex,
              endIndex: rowCount,
            },
          },
        },
      ],
    },
  });
  return rowCount - firstMissingIndex;
}

export async function ensureSpreadsheetLayout(spreadsheetId: string): Promise<void> {
  await ensurePitchHeaders(spreadsheetId);
  await ensureFullTextTab(spreadsheetId);
  await deleteRowsMissingRowId(spreadsheetId);
  const { rows, rowNumbers } = await readAllPitchRows(spreadsheetId);
  const lastDataRow = rowNumbers.at(-1) ?? 1;
  await ensureCheckboxColumns(spreadsheetId, lastDataRow);
  await writeCheckboxValues(
    spreadsheetId,
    rows.map((row, i) => ({
      rowNumber: rowNumbers[i]!,
      shortlisted: row.shortlisted,
      archived: row.archived,
    })),
  );
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export async function readAllPitchRows(
  spreadsheetId: string,
): Promise<{ rows: PitchRow[]; rowNumbers: number[] }> {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PITCHES_TAB}!A2:${colLetter(PITCH_HEADERS.length)}`,
  });
  const data = res.data.values ?? [];
  const rows: PitchRow[] = [];
  const rowNumbers: number[] = [];
  data.forEach((line, idx) => {
    const cells = line as string[];
    if (!String(cells[0] ?? "").trim()) return;
    if (!cells.some((c) => String(c).trim())) return;
    rows.push(valuesToRow(cells));
    rowNumbers.push(idx + 2);
  });
  return { rows, rowNumbers };
}

export async function appendPitchRows(
  spreadsheetId: string,
  rows: PitchRow[],
  overflow: { row_id: string; full_pitch: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const sheets = await sheetsClient();
  const values = rows.map((r) => {
    const copy = { ...r };
    const formatted = pitchesTabFullPitchCell(copy.full_pitch, copy.row_id);
    copy.full_pitch = formatted.cell;
    if (formatted.parts.length > 0) {
      overflow.push({
        row_id: copy.row_id,
        full_pitch: r.full_pitch,
      });
    }
    return rowToValues(copy);
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${PITCHES_TAB}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  if (overflow.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${FULL_TEXT_TAB}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: overflow.flatMap((o) =>
          splitTextForSheetCells(o.full_pitch).map((part) => [o.row_id, part]),
        ),
      },
    });
  }
  return rows.length;
}

export type NarrativeUpdate = {
  row_id: string;
  rowNumber: number;
  thesis_short: string;
  full_pitch: string;
  source_url?: string;
  ticker?: string;
  exchange_country?: string;
  company?: string;
};

async function batchValueRanges(
  spreadsheetId: string,
  data: sheets_v4.Schema$ValueRange[],
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW",
): Promise<void> {
  if (data.length === 0) return;
  const sheets = await sheetsClient();
  const CHUNK = 40;
  for (let i = 0; i < data.length; i += CHUNK) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption, data: data.slice(i, i + CHUNK) },
    });
  }
}

function cellRange(header: keyof PitchRow, rowNumber: number): string {
  const col = PITCH_HEADERS.indexOf(header) + 1;
  return `${PITCHES_TAB}!${colLetter(col)}${rowNumber}`;
}

/** In-place rewrite of thesis / full_pitch (and optional URL/ticker). Does not insert rows. */
export async function updatePitchNarratives(
  spreadsheetId: string,
  updates: NarrativeUpdate[],
  overflow: { row_id: string; full_pitch: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  const data: sheets_v4.Schema$ValueRange[] = [];
  const overflowIds: string[] = [];
  for (const u of updates) {
    const formatted = pitchesTabFullPitchCell(u.full_pitch, u.row_id);
    let pitch = formatted.cell;
    if (formatted.parts.length > 0) {
      overflow.push({ row_id: u.row_id, full_pitch: u.full_pitch });
      overflowIds.push(u.row_id);
    }
    data.push({
      range: cellRange("thesis_short", u.rowNumber),
      values: [[safeCell(truncateToSheetCell(u.thesis_short))]],
    });
    data.push({
      range: cellRange("full_pitch", u.rowNumber),
      values: [[safeCell(truncateToSheetCell(pitch))]],
    });
    if (u.source_url !== undefined) {
      data.push({
        range: cellRange("source_url", u.rowNumber),
        values: [[safeCell(truncateToSheetCell(u.source_url))]],
      });
    }
    if (u.ticker !== undefined) {
      data.push({
        range: cellRange("ticker", u.rowNumber),
        values: [[safeCell(u.ticker)]],
      });
    }
    if (u.exchange_country !== undefined) {
      data.push({
        range: cellRange("exchange_country", u.rowNumber),
        values: [[safeCell(u.exchange_country)]],
      });
    }
    if (u.company !== undefined) {
      data.push({
        range: cellRange("company", u.rowNumber),
        values: [[safeCell(u.company)]],
      });
    }
  }
  await batchValueRanges(spreadsheetId, data, "RAW");
  if (overflowIds.length > 0) {
    await replaceFullTextRows(
      spreadsheetId,
      overflow.filter((o) => overflowIds.includes(o.row_id)),
    );
  }
}

export async function replaceFullTextRows(
  spreadsheetId: string,
  items: { row_id: string; full_pitch: string }[],
): Promise<void> {
  if (items.length === 0) return;
  await ensureFullTextTab(spreadsheetId);
  const sheets = await sheetsClient();
  const { sheetId } = await fullTextSheetMeta(spreadsheetId);
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${FULL_TEXT_TAB}!A:B`,
  });
  const lines = existing.data.values ?? [];
  const ids = new Set(items.map((i) => i.row_id));
  const deleteRows: number[] = [];
  lines.forEach((line, idx) => {
    if (idx === 0) return;
    const rid = String(line[0] ?? "");
    if (ids.has(rid)) deleteRows.push(idx + 1);
  });
  if (sheetId !== undefined && deleteRows.length > 0) {
    const sorted = [...deleteRows].sort((a, b) => b - a);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: sorted.map((rowNumber) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        })),
      },
    });
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${FULL_TEXT_TAB}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: items.flatMap((o) =>
        splitTextForSheetCells(o.full_pitch).map((part) => [o.row_id, part]),
      ),
    },
  });
}

export async function updateMetricCells(
  spreadsheetId: string,
  updates: { rowNumber: number; metrics: Partial<PitchRow> }[],
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = await sheetsClient();
  const data: sheets_v4.Schema$ValueRange[] = updates.flatMap(({ rowNumber, metrics }) => {
    const out: sheets_v4.Schema$ValueRange[] = [];
    const metricKeys = [
      "pe",
      "ev_ebit",
      "roic",
      "net_debt_ebitda",
      "metrics_source",
    ] as const;
    for (const key of metricKeys) {
      if (metrics[key] === undefined) continue;
      const col = PITCH_HEADERS.indexOf(key) + 1;
      out.push({
        range: `${PITCHES_TAB}!${colLetter(col)}${rowNumber}`,
        values: [[String(metrics[key])]],
      });
    }
    return out;
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export async function deleteSheetRows(
  spreadsheetId: string,
  sheetRowNumbers: number[],
): Promise<void> {
  if (sheetRowNumbers.length === 0) return;
  const sheets = await sheetsClient();
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const pitchSheet = sheetMeta.data.sheets?.find(
    (s) => s.properties?.title === PITCHES_TAB,
  );
  const sheetId = pitchSheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return;

  const sorted = [...sheetRowNumbers].sort((a, b) => b - a);
  const requests: sheets_v4.Schema$Request[] = sorted.map((rowNumber) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

export function mergeExistingUserFields(
  existing: PitchRow,
  incoming: PitchRow,
): PitchRow {
  return {
    ...incoming,
    shortlisted: existing.shortlisted,
    archived: existing.archived,
    notes: existing.notes,
    pitched_by: existing.pitched_by || incoming.pitched_by,
  };
}

export async function getRowById(
  spreadsheetId: string,
  rowId: string,
): Promise<PitchRow | undefined> {
  const { rows } = await readAllPitchRows(spreadsheetId);
  return rows.find((r) => r.row_id === rowId);
}

/** Concatenate FullText parts for a row; empty string if none. */
export async function readFullTextForRow(
  spreadsheetId: string,
  rowId: string,
): Promise<string> {
  try {
    const sheets = await sheetsClient();
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${FULL_TEXT_TAB}!A:B`,
    });
    const lines = existing.data.values ?? [];
    const chunks: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const rid = String(lines[i]?.[0] ?? "");
      if (rid !== rowId) continue;
      const part = String(lines[i]?.[1] ?? "").replace(/^\[part \d+\/\d+\]\n/, "");
      chunks.push(part);
    }
    return chunks.join("");
  } catch {
    return "";
  }
}

export async function deleteFullTextForRowIds(
  spreadsheetId: string,
  rowIds: string[],
): Promise<number> {
  if (rowIds.length === 0) return 0;
  await ensureFullTextTab(spreadsheetId);
  const sheets = await sheetsClient();
  const { sheetId } = await fullTextSheetMeta(spreadsheetId);
  if (sheetId === undefined) return 0;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${FULL_TEXT_TAB}!A:B`,
  });
  const lines = existing.data.values ?? [];
  const ids = new Set(rowIds);
  const deleteRows: number[] = [];
  lines.forEach((line, idx) => {
    if (idx === 0) return;
    const rid = String(line[0] ?? "");
    if (ids.has(rid)) deleteRows.push(idx + 1);
  });
  if (deleteRows.length === 0) return 0;
  const sorted = [...deleteRows].sort((a, b) => b - a);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: sorted.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })),
    },
  });
  return deleteRows.length;
}
