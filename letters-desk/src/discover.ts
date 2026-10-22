import { fetchBytes } from "../../idea-screener/bot/lib/ingest/fetch.js";
import type { FundConfig } from "./types.js";

const DEFAULT_BLOCKED = new Set([
  "buysidedigest.com",
  "www.buysidedigest.com",
  "bsdpdfapi-production.up.railway.app",
]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function absUrl(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}

export function pdfLinksFromHtml(
  html: string,
  baseUrl: string,
  include: string | undefined,
  blocked: Set<string>,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const includeRe = include ? new RegExp(include, "i") : null;
  for (const m of html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) {
    const abs = absUrl(m[1] ?? "", baseUrl);
    if (!abs) continue;
    const host = hostOf(abs);
    if (!host || blocked.has(host) || [...blocked].some((b) => host.endsWith(b))) {
      continue;
    }
    if (includeRe && !includeRe.test(abs)) continue;
    const key = abs.split("?")[0]!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(abs);
  }
  return found;
}

export async function discoverNewPdfs(
  fund: FundConfig,
  knownUrls: Set<string>,
  blockedHosts: string[],
  limit = 3,
): Promise<string[]> {
  if (!fund.index_url) return [];
  const blocked = new Set([...DEFAULT_BLOCKED, ...blockedHosts.map((h) => h.toLowerCase())]);
  if (blocked.has(hostOf(fund.index_url))) return [];
  let html = "";
  try {
    const fetched = await fetchBytes(fund.index_url);
    html = fetched.bytes.toString("utf8");
  } catch {
    return [];
  }
  const links = pdfLinksFromHtml(html, fund.index_url, fund.pdf_url_include, blocked);
  const fresh: string[] = [];
  for (const url of links) {
    const key = url.split("?")[0]!.toLowerCase();
    if (knownUrls.has(key) || knownUrls.has(url)) continue;
    fresh.push(url);
    if (fresh.length >= limit) break;
  }
  return fresh;
}

export function slugId(fundId: string, url: string, date: string): string {
  const file = (url.split("/").pop() ?? "letter")
    .replace(/\.pdf(\?.*)?$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${fundId}-${date || "undated"}-${file}`.replace(/-+/g, "-");
}
