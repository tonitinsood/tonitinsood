import { findTickers, isJunkTicker } from "./extract-heuristic.js";
import { readableDocsFromUrl, type ReadableDoc } from "./ingest/fetch.js";
import { needsNarrativeRewrite, thesisFromBody } from "./ingest/readable.js";
import {
  readAllPitchRows,
  updatePitchNarratives,
  type NarrativeUpdate,
} from "./sheets.js";
import type { PitchRow } from "./types.js";

export type RewriteTextResult = {
  rewritten: number;
  skipped: number;
  urlsSeen: string[];
};

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase();
}

/**
 * Re-fetch sources for existing Pitches rows and overwrite full_pitch / thesis_short
 * in place. Never inserts rows. Preserves shortlisted, archived, notes, row_id.
 */
export async function rewriteUnreadablePitchText(
  spreadsheetId: string,
): Promise<RewriteTextResult> {
  const { rows, rowNumbers } = await readAllPitchRows(spreadsheetId);
  const groups = new Map<
    string,
    { row: PitchRow; rowNumber: number }[]
  >();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const url = row.source_url?.trim();
    if (!url) continue;
    const list = groups.get(url) ?? [];
    list.push({ row, rowNumber: rowNumbers[i]! });
    groups.set(url, list);
  }

  const cache = new Map<string, Promise<ReadableDoc[]>>();
  const load = (url: string, followHub: boolean) => {
    const key = `${followHub ? "hub" : "one"}:${url}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = readableDocsFromUrl(url, { followHub });
    cache.set(key, pending);
    return pending;
  };

  const updates: NarrativeUpdate[] = [];
  const urlsSeen: string[] = [];
  let skipped = 0;

  for (const [url, group] of groups) {
    const needs = group.filter(
      ({ row }) => needsNarrativeRewrite(row.full_pitch, row.thesis_short),
    );
    if (needs.length === 0) {
      skipped += group.length;
      urlsSeen.push(url);
      continue;
    }
    const followHub = group.some(({ row }) => row.source_type === "letter");
    const docs = await load(url, followHub);
    const usable = docs.filter((d) => d.body.trim().length > 0);
    if (usable.length === 0) {
      skipped += group.length;
      continue;
    }
    urlsSeen.push(url);
    for (const d of usable) urlsSeen.push(d.source_url);

    const usedTickers = new Set(
      group.map((g) => g.row.ticker.trim().toUpperCase()).filter((t) => !isJunkTicker(t)),
    );

    for (let i = 0; i < group.length; i++) {
      const { row, rowNumber } = group[i]!;
      if (!needsNarrativeRewrite(row.full_pitch, row.thesis_short)) {
        skipped += 1;
        continue;
      }
      const doc = usable[Math.min(i, usable.length - 1)]!;
      const thesis = thesisFromBody(doc.title || row.source_name, doc.body);
      const update: NarrativeUpdate = {
        row_id: row.row_id,
        rowNumber,
        thesis_short: thesis,
        full_pitch: doc.body,
      };
      if (doc.source_url && normalizeUrl(doc.source_url) !== normalizeUrl(url)) {
        update.source_url = doc.source_url;
      }
      if (isJunkTicker(row.ticker)) {
        const candidates = findTickers(doc.body).filter((t) => !usedTickers.has(t));
        const next = candidates[0];
        if (next) {
          usedTickers.add(next);
          update.ticker = next;
        }
      }
      updates.push(update);
    }
  }

  const overflow: { row_id: string; full_pitch: string }[] = [];
  await updatePitchNarratives(spreadsheetId, updates, overflow);
  return {
    rewritten: updates.length,
    skipped,
    urlsSeen: [...new Set(urlsSeen.filter(Boolean))],
  };
}
