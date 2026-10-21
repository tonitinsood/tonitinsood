import type { ToolContext } from "@cursor/bdk";
import type { sheets_v4 } from "googleapis";
import {
  FULL_PITCH_CELL_MAX,
  FULL_TEXT_TAB,
  PITCHES_TAB,
  PITCH_HEADERS,
  SHEET_TITLE,
} from "./columns.js";
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

function rowToValues(row: PitchRow): string[] {
  return PITCH_HEADERS.map((key) => {
    const v = row[key];
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return v ?? "";
  });
}

function parseBool(cell: string | undefined): boolean {
  if (!cell) return false;
  const s = cell.trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
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
  await ensurePitchHeaders(id);
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
    if (copy.full_pitch.length > FULL_PITCH_CELL_MAX) {
      overflow.push({
        row_id: copy.row_id,
        full_pitch: copy.full_pitch,
      });
      copy.full_pitch = copy.full_pitch.slice(0, FULL_PITCH_CELL_MAX - 20) + "… [see FullText tab]";
    }
    return rowToValues(copy);
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${PITCHES_TAB}!A:A`,
    valueInputOption: "RAW",
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
        values: overflow.map((o) => [o.row_id, o.full_pitch]),
      },
    });
  }
  return rows.length;
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
