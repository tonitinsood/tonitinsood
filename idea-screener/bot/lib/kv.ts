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

/** Strip www, trailing slash, and hash so redirect variants still match. */
export function canonicalSourceUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    const search = u.search.toLowerCase();
    return `${u.protocol}//${host}${path}${search}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

export function dedupeKey(sourceUrl: string, ticker: string): string {
  return `${canonicalSourceUrl(sourceUrl)}|${ticker.trim().toUpperCase()}`;
}

/**
 * Last path segment, so Substack `/p/slug` and the redirected
 * `semianalysis.com/2025/09/16/slug` count as the same document.
 */
export function sourceUrlSlug(url: string): string {
  const c = canonicalSourceUrl(url);
  try {
    const u = new URL(c);
    const parts = u.pathname.split("/").filter(Boolean);
    return (parts.at(-1) ?? "").toLowerCase();
  } catch {
    return "";
  }
}

export function metricCacheKey(ticker: string, dayIso: string): string {
  return `${ticker.toUpperCase()}|${dayIso.slice(0, 10)}`;
}
