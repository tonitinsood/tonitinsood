import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { KV, kvGet } from "../lib/kv.js";
import { getRowById, readFullTextForRow, spreadsheetIdFromEnv } from "../lib/sheets.js";

export default defineTool({
  description:
    "Load a pitch row from the master Google Sheet by row_id and return a structured brief for deep research (thesis, metrics, source, pitched_by, links).",
  effect: "read",
  inputSchema: z.object({
    row_id: z.string().uuid().describe("Stable row_id from the Pitches sheet"),
  }),
  async execute({ row_id }, ctx) {
    const spreadsheetId =
      spreadsheetIdFromEnv() ?? (await kvGet<string>(ctx, KV.sheetId));
    if (!spreadsheetId) {
      return {
        error: "no_sheet",
        message:
          "Set Google_Sheet_Id (or GOOGLE_SHEET_ID) to your shared spreadsheet, or run runDailyScreen once so host.kv stores screener:sheet_id.",
      };
    }
    const row = await getRowById(spreadsheetId, row_id);
    if (!row) {
      return { error: "not_found", row_id };
    }
    const overflow = await readFullTextForRow(spreadsheetId, row_id);
    const fullPitch = overflow.trim() || row.full_pitch;
    return {
      row_id: row.row_id,
      ticker: row.ticker,
      company: row.company,
      date: row.date,
      source_type: row.source_type,
      source_name: row.source_name,
      pitched_by: row.pitched_by,
      thesis_short: row.thesis_short,
      full_pitch: fullPitch,
      metrics: {
        pe: row.pe,
        ev_ebit: row.ev_ebit,
        roic: row.roic,
        net_debt_ebitda: row.net_debt_ebitda,
        metrics_source: row.metrics_source,
      },
      source_url: row.source_url,
      shortlisted: row.shortlisted,
      archived: row.archived,
      notes: row.notes,
      research_prompt:
        "Produce a research brief: business overview, moat, catalysts, bear case, and comps. Use pitched_by as the advocate; source_name as the outlet/fund.",
    };
  },
});
