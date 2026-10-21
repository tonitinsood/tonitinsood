import { randomUUID } from "node:crypto";
import type { ToolContext } from "@cursor/bdk";
import {
  appendPitchRows,
  deleteSheetRows,
  ensureCheckboxColumns,
  ensureSpreadsheetLayout,
  readAllPitchRows,
  resolveOrCreateSpreadsheetId,
  updateMetricCells,
  writeCheckboxValues,
} from "./sheets.js";
import { extractPitchesHeuristic } from "./extract-heuristic.js";
import { ingestAllSources } from "./ingest/sources.js";
import { dedupeKey, KV, kvGet, kvPut, metricCacheKey } from "./kv.js";
import { rowsEligibleForPurge } from "./purge.js";
import { rewriteUnreadablePitchText } from "./rewrite-text.js";
import { enrichTickerMetrics } from "./metrics.js";
import type { MetricSnapshot, PitchRow } from "./types.js";

export type DailyScreenResult = {
  spreadsheetId: string;
  appended: number;
  purged: number;
  metricsUpdated: number;
  skippedDedupe: number;
  rewritten: number;
  dryRun: boolean;
};

export async function runDailyScreenPipeline(
  ctx: ToolContext,
  opts: { dryRun?: boolean } = {},
): Promise<DailyScreenResult> {
  const dryRun = opts.dryRun ?? false;
  let spreadsheetId = await resolveOrCreateSpreadsheetId(ctx, dryRun);
  if (!spreadsheetId) {
    spreadsheetId = "dry-run-no-sheet";
  } else if (!dryRun) {
    await ensureSpreadsheetLayout(spreadsheetId);
  }

  const dedupeSet =
    (await kvGet<Record<string, true>>(ctx, KV.dedupe)) ?? {};
  const metricCache =
    (await kvGet<Record<string, MetricSnapshot>>(ctx, KV.metricCache)) ?? {};

  let rewritten = 0;
  const existingSourceUrls = new Set<string>();

  if (spreadsheetId !== "dry-run-no-sheet") {
    if (!dryRun) {
      const rewrite = await rewriteUnreadablePitchText(spreadsheetId);
      rewritten = rewrite.rewritten;
      for (const u of rewrite.urlsSeen) {
        existingSourceUrls.add(u.trim().toLowerCase());
      }
    }
    const { rows: existingRows } = await readAllPitchRows(spreadsheetId);
    for (const row of existingRows) {
      if (row.source_url?.trim()) {
        existingSourceUrls.add(row.source_url.trim().toLowerCase());
      }
      if (!row.ticker?.trim() || !row.source_url?.trim()) continue;
      dedupeSet[dedupeKey(row.source_url, row.ticker)] = true;
    }
  }

  const docs = await ingestAllSources();
  const nowIso = new Date().toISOString();
  const day = nowIso.slice(0, 10);
  const fmpKey = process.env.FMP_API_KEY;

  const newRows: PitchRow[] = [];
  let skippedDedupe = 0;

  for (const doc of docs) {
    const extracted = extractPitchesHeuristic(doc);
    for (const pitch of extracted) {
      if (!pitch.ticker) continue;
      const urlKey = pitch.source_url.trim().toLowerCase();
      if (existingSourceUrls.has(urlKey)) {
        skippedDedupe += 1;
        continue;
      }
      const dKey = dedupeKey(pitch.source_url, pitch.ticker);
      if (dedupeSet[dKey]) {
        skippedDedupe += 1;
        continue;
      }
      const mKey = metricCacheKey(pitch.ticker, day);
      let metrics = metricCache[mKey];
      if (!metrics) {
        metrics = await enrichTickerMetrics(pitch.ticker, fmpKey);
        metricCache[mKey] = metrics;
      }
      const row: PitchRow = {
        row_id: randomUUID(),
        date: pitch.date,
        discovered_at: nowIso,
        source_type: pitch.source_type,
        source_name: pitch.source_name,
        pitched_by: pitch.pitched_by,
        ticker: pitch.ticker,
        exchange_country: pitch.exchange_country,
        company: pitch.company,
        thesis_short: pitch.thesis_short,
        full_pitch: pitch.full_pitch,
        pe: metrics.pe,
        ev_ebit: metrics.ev_ebit,
        roic: metrics.roic,
        net_debt_ebitda: metrics.net_debt_ebitda,
        metrics_source: metrics.metrics_source,
        source_url: pitch.source_url,
        shortlisted: false,
        archived: false,
        notes: "",
      };
      newRows.push(row);
      dedupeSet[dKey] = true;
    }
  }

  let purged = 0;
  let metricsUpdated = 0;

  if (!dryRun && spreadsheetId !== "dry-run-no-sheet") {
    const overflow: { row_id: string; full_pitch: string }[] = [];
    await appendPitchRows(spreadsheetId, newRows, overflow);
    await kvPut(ctx, KV.dedupe, dedupeSet);
    await kvPut(ctx, KV.metricCache, metricCache);

    const snapshot = await readAllPitchRows(spreadsheetId);
    const toDelete = rowsEligibleForPurge(
      snapshot.rows,
      snapshot.rowNumbers,
      new Date(),
    );
    if (toDelete.length) {
      await deleteSheetRows(spreadsheetId, toDelete);
      purged = toDelete.length;
    }

    const { rows, rowNumbers } = toDelete.length
      ? await readAllPitchRows(spreadsheetId)
      : snapshot;

    const refreshUpdates: { rowNumber: number; metrics: Partial<PitchRow> }[] =
      [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    rows.forEach((row, idx) => {
      const discovered = Date.parse(row.discovered_at);
      if (Number.isNaN(discovered) || discovered < cutoff) return;
      if (!row.ticker) return;
      const mKey = metricCacheKey(row.ticker, day);
      const cached = metricCache[mKey];
      if (!cached) return;
      refreshUpdates.push({
        rowNumber: rowNumbers[idx]!,
        metrics: {
          pe: cached.pe,
          ev_ebit: cached.ev_ebit,
          roic: cached.roic,
          net_debt_ebitda: cached.net_debt_ebitda,
          metrics_source: cached.metrics_source,
        },
      });
    });
    await updateMetricCells(spreadsheetId, refreshUpdates);
    metricsUpdated = refreshUpdates.length;
    await writeCheckboxValues(
      spreadsheetId,
      rows.map((row, idx) => ({
        rowNumber: rowNumbers[idx]!,
        shortlisted: row.shortlisted,
        archived: row.archived,
      })),
    );
    const lastDataRow = rowNumbers.at(-1) ?? 1;
    await ensureCheckboxColumns(spreadsheetId, lastDataRow);
  }

  return {
    spreadsheetId,
    appended: dryRun ? newRows.length : newRows.length,
    purged,
    metricsUpdated,
    skippedDedupe,
    rewritten,
    dryRun,
  };
}
