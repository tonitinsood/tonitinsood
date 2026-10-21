import type { JsonValue, ToolContext } from "@cursor/bdk";

export const KV = {
  sheetId: "screener:sheet_id",
  cursors: "screener:cursors",
  dedupe: "screener:dedupe_hashes",
  metricCache: "screener:metric_cache",
} as const;

export type SourceCursors = Record<string, string>;

export async function kvGet<T>(
  ctx: Pick<ToolContext, "host">,
  key: string,
): Promise<T | undefined> {
  const raw = await ctx.host.kv.get(key);
  if (raw === undefined || raw === null) return undefined;
  return raw as T;
}

export async function kvPut(
  ctx: Pick<ToolContext, "host">,
  key: string,
  value: JsonValue,
): Promise<void> {
  await ctx.host.kv.put(key, value);
}

export function dedupeKey(sourceUrl: string, ticker: string): string {
  return `${sourceUrl.trim().toLowerCase()}|${ticker.trim().toUpperCase()}`;
}

export function metricCacheKey(ticker: string, dayIso: string): string {
  return `${ticker.toUpperCase()}|${dayIso.slice(0, 10)}`;
}
