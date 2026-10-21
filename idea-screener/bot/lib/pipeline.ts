import { randomUUID } from "node:crypto";
import type { ToolContext } from "@cursor/bdk";
import {
  appendPitchRows,
  deleteFullTextForRowIds,
  deleteSheetRows,
  ensureCheckboxColumns,
  ensureSpreadsheetLayout,
  readAllPitchRows,
  resolveOrCreateSpreadsheetId,
  updateMetricCells,
  writeCheckboxValues,
} from "./sheets.js";
import {
  extractPitchesHeuristic,
  isConcretePitch,
  isJunkSeedRow,
} from "./extract-heuristic.js";
import { ingestAllSources } from "./ingest/sources.js";
import { isNonUsListing, rankAndCapPitches } from "./markets.js";
import {
  canonicalSourceUrl,
  dedupeKey,
  KV,
  kvGet,
  kvPut,
  metricCacheKey,
  sourceUrlSlug,
} from "./kv.js";
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
  skippedNotPitch: number;
  clearedNonPitch: number;
  nonUsAppended: number;
  rewritten: number;
  dryRun: boolean;
  sourcesUsed: { source_type: string; source_name: string; docs: number }[];
  samples: { ticker: string; company: string; thesis_short: string; exchange_country: string }[];
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
  let clearedNonPitch = 0;
  const existingSourceUrls = new Set<string>();
  const existingSlugs = new Set<string>();

  const rememberUrl = (url: string) => {
    const key = canonicalSourceUrl(url);
    if (key) existingSourceUrls.add(key);
    const slug = sourceUrlSlug(url);
    if (slug.includes("-") || slug.length >= 16) existingSlugs.add(slug);
  };

  if (spreadsheetId !== "dry-run-no-sheet") {
    if (!dryRun) {
      clearedNonPitch = await clearNonPitchRows(spreadsheetId);
      const rewrite = await rewriteUnreadablePitchText(spreadsheetId);
      rewritten = rewrite.rewritten;
      for (const u of rewrite.urlsSeen) rememberUrl(u);
    }
    const { rows: existingRows } = await readAllPitchRows(spreadsheetId);
    for (const row of existingRows) {
      if (row.source_url?.trim()) rememberUrl(row.source_url);
      if (!row.source_url?.trim()) continue;
      const name = row.ticker.trim() || row.company.trim();
      if (!name) continue;
      dedupeSet[dedupeKey(row.source_url, name)] = true;
    }
  }

  const docs = await ingestAllSources();
  const nowIso = new Date().toISOString();
  const day = nowIso.slice(0, 10);
  const fmpKey = process.env.FMP_API_KEY;

  const sourcesUsed = summarizeSources(docs);
  const extractedAll = docs.flatMap((doc) => extractPitchesHeuristic(doc));
  const concrete = extractedAll.filter((p) => isConcretePitch(p));
  const skippedNotPitch = extractedAll.length - concrete.length;
  const ranked = rankAndCapPitches(concrete);

  const newRows: PitchRow[] = [];
  let skippedDedupe = 0;

  for (const pitch of ranked) {
    if (!pitch.ticker && !pitch.company) continue;
    const urlKey = canonicalSourceUrl(pitch.source_url);
    const slug = sourceUrlSlug(pitch.source_url);
    const dKey = dedupeKey(pitch.source_url, pitch.ticker || pitch.company);
    if (dedupeSet[dKey]) {
      skippedDedupe += 1;
      continue;
    }
    // Same URL already on the sheet for this ticker/company is a duplicate;
    // other names in the same letter may still be new.
    if (!pitch.ticker && (existingSourceUrls.has(urlKey) || (slug && existingSlugs.has(slug)))) {
      skippedDedupe += 1;
      continue;
    }
    const emptyMetrics: MetricSnapshot = {
      pe: "",
      ev_ebit: "",
      roic: "",
      net_debt_ebitda: "",
      metrics_source: "",
    };
    let metrics = emptyMetrics;
    if (pitch.ticker) {
      const mKey = metricCacheKey(pitch.ticker, day);
      metrics = metricCache[mKey];
      if (!metrics) {
        metrics = await enrichTickerMetrics(pitch.ticker, fmpKey);
        metricCache[mKey] = metrics;
      }
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
      const purgedIds = snapshot.rows
        .filter((_, i) => toDelete.includes(snapshot.rowNumbers[i]!))
        .map((r) => r.row_id)
        .filter(Boolean);
      await deleteSheetRows(spreadsheetId, toDelete);
      await deleteFullTextForRowIds(spreadsheetId, purgedIds);
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

  const nonUsAppended = newRows.filter((r) =>
    isNonUsListing(r.ticker, r.exchange_country),
  ).length;
  const samples = newRows.slice(0, 3).map((r) => ({
    ticker: r.ticker,
    company: r.company,
    thesis_short: r.thesis_short.slice(0, 280),
    exchange_country: r.exchange_country,
  }));

  return {
    spreadsheetId,
    appended: newRows.length,
    purged,
    metricsUpdated,
    skippedDedupe,
    skippedNotPitch,
    clearedNonPitch,
    nonUsAppended,
    rewritten,
    dryRun,
    sourcesUsed,
    samples,
  };
}

function summarizeSources(
  docs: { source_type: string; source_name: string }[],
): { source_type: string; source_name: string; docs: number }[] {
  const map = new Map<string, { source_type: string; source_name: string; docs: number }>();
  for (const d of docs) {
    const key = `${d.source_type}|${d.source_name}`;
    const cur = map.get(key) ?? {
      source_type: d.source_type,
      source_name: d.source_name,
      docs: 0,
    };
    cur.docs += 1;
    map.set(key, cur);
  }
  return [...map.values()];
}

/** Drop letter dumps and other non-pitches. Keep user-ticked shortlist/archive rows. */
export async function clearNonPitchRows(spreadsheetId: string): Promise<number> {
  const { rows, rowNumbers } = await readAllPitchRows(spreadsheetId);
  const toDelete: number[] = [];
  const ids: string[] = [];
  rows.forEach((row, i) => {
    if (row.shortlisted || row.archived) return;
    if (isJunkSeedRow(row)) {
      toDelete.push(rowNumbers[i]!);
      if (row.row_id) ids.push(row.row_id);
      return;
    }
    // Judge thesis_short, not a 40k letter dump that mentions "catalyst" in passing.
    if (isConcretePitch({ ...row, full_pitch: row.thesis_short })) return;
    toDelete.push(rowNumbers[i]!);
    if (row.row_id) ids.push(row.row_id);
  });
  if (toDelete.length === 0) return 0;
  await deleteSheetRows(spreadsheetId, toDelete);
  await deleteFullTextForRowIds(spreadsheetId, ids);
  return toDelete.length;
}
