import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import type { IngestDocument, SourceType } from "../types.js";
import { readableDocsFromUrl } from "./fetch.js";
import { extractArticleText } from "./html.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const BODY_MAX = 400_000;
const SEC_UA = "tonitinsood-idea-screener contact@tonitinsood.com";

export type LettersConfig = {
  letters: {
    name: string;
    url: string;
    type: "pdf" | "html" | "rss";
    pitched_by?: string;
    default_country?: string;
    max_items?: number;
  }[];
};
export type SubstackConfig = {
  substacks: {
    name: string;
    feed_url: string;
    pitched_by?: string;
    default_country?: string;
    max_items?: number;
  }[];
};
export type SecActivistCik = {
  name: string;
  cik: string;
  pitched_by?: string;
};
export type SecConfig = {
  edgar_atom_url?: string;
  edgar_atom_urls?: string[];
  activist_ciks?: SecActivistCik[];
  keywords?: string[];
  keywords_8k?: string[];
  max_age_days?: number;
};
export type XConfig = {
  accounts: { handle: string; display_name?: string; syndication_url?: string }[];
};

const rss = new Parser({
  timeout: 20_000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; idea-screener/1.0; +https://github.com/tonitinsood/tonitinsood)",
  },
});
const secRss = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": SEC_UA, Accept: "application/atom+xml,application/xml,text/xml" },
});

export async function loadJson<T>(rel: string): Promise<T> {
  const text = await readFile(path.join(root, rel), "utf8");
  return JSON.parse(text) as T;
}

async function docsFromRssItem(opts: {
  source_type: SourceType;
  source_name: string;
  pitched_by: string;
  link: string;
  date: string;
  title: string;
  snippet: string;
  default_country?: string;
}): Promise<IngestDocument> {
  let body = opts.snippet;
  try {
    const docs = await readableDocsFromUrl(opts.link, { titleHint: opts.title });
    body = docs[0]?.body.slice(0, BODY_MAX) || body;
  } catch {
    /* keep snippet */
  }
  const snippet = extractArticleText(String(body));
  return {
    source_type: opts.source_type,
    source_name: opts.source_name,
    pitched_by: opts.pitched_by,
    source_url: opts.link,
    date: opts.date,
    title: opts.title,
    body: `${opts.title}\n\n${snippet}`.trim().slice(0, BODY_MAX),
    default_country: opts.default_country || "",
  };
}

export async function ingestLetters(): Promise<IngestDocument[]> {
  const cfg = await loadJson<LettersConfig>("config/letters.json");
  const out: IngestDocument[] = [];
  for (const letter of cfg.letters) {
    try {
      if (letter.type === "rss" || /\/feed\/?$/i.test(letter.url)) {
        const feed = await rss.parseURL(letter.url);
        const max = letter.max_items ?? 6;
        for (const item of feed.items.slice(0, max)) {
          const link = item.link ?? letter.url;
          out.push(
            await docsFromRssItem({
              source_type: "letter",
              source_name: letter.name,
              pitched_by: String(item.creator ?? item.author ?? letter.pitched_by ?? letter.name),
              link,
              date: item.isoDate ?? new Date().toISOString(),
              title: item.title ?? letter.name,
              snippet: String(item.contentSnippet ?? item.content ?? item.summary ?? ""),
              default_country: letter.default_country,
            }),
          );
        }
        continue;
      }
      const docs = await readableDocsFromUrl(letter.url, {
        followHub: true,
        titleHint: letter.name,
      });
      for (const doc of docs) {
        out.push({
          source_type: "letter",
          source_name: letter.name,
          pitched_by: letter.pitched_by ?? letter.name,
          source_url: doc.source_url,
          date: new Date().toISOString().slice(0, 10),
          title: doc.title || letter.name,
          body: doc.body.slice(0, BODY_MAX),
          default_country: letter.default_country || "",
        });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function ingestSubstack(): Promise<IngestDocument[]> {
  const cfg = await loadJson<SubstackConfig>("config/substack.json");
  const out: IngestDocument[] = [];
  for (const pub of cfg.substacks) {
    try {
      const feed = await rss.parseURL(pub.feed_url);
      const max = pub.max_items ?? 5;
      for (const item of feed.items.slice(0, max)) {
        const link = item.link ?? pub.feed_url;
        const author = item.creator ?? item.author ?? pub.pitched_by ?? pub.name;
        out.push(
          await docsFromRssItem({
            source_type: "substack",
            source_name: pub.name,
            pitched_by: String(author),
            link,
            date: item.isoDate ?? new Date().toISOString(),
            title: item.title ?? pub.name,
            snippet: String(item.contentSnippet ?? item.content ?? item.summary ?? ""),
            default_country: pub.default_country,
          }),
        );
      }
    } catch {
      /* skip feed */
    }
  }
  return out;
}

function classifySecForm(title: string, term = ""): SourceType | null {
  const t = `${title} ${term}`.toUpperCase();
  if (t.includes("SC 13D") || t.includes("13D")) return "sec_13d";
  if (t.includes("SC 13G") || t.includes("13G")) return "sec_13g";
  if (t.includes("8-K")) return "sec_8k";
  return null;
}

function withinAge(iso: string | undefined, maxAgeDays: number): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function cikAtomUrl(cik: string): string {
  const padded = cik.replace(/\D/g, "").padStart(10, "0");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=SC+13D&dateb=&owner=include&count=10&output=atom`;
}

async function ingestSecFeed(
  url: string,
  cfg: SecConfig,
  pitchedByHint?: string,
  sourceNameHint?: string,
): Promise<IngestDocument[]> {
  const out: IngestDocument[] = [];
  const maxAge = cfg.max_age_days ?? 14;
  const keywords8k = (cfg.keywords_8k ?? cfg.keywords ?? []).map((k) => k.toLowerCase());
  try {
    const feed = await secRss.parseURL(url);
    for (const item of feed.items.slice(0, 20)) {
      const title = item.title ?? "";
      const term = String((item as { categories?: string[] }).categories?.[0] ?? "");
      const form = classifySecForm(title, term);
      if (!form) continue;
      const date = item.isoDate ?? "";
      if (!withinAge(date, maxAge)) continue;
      if (form === "sec_8k" && keywords8k.length) {
        const blob = `${title} ${item.contentSnippet ?? ""}`.toLowerCase();
        if (!keywords8k.some((k) => blob.includes(k))) continue;
      }
      const link = item.link ?? url;
      let body = item.contentSnippet ?? item.summary ?? title;
      try {
        if (link) {
          const docs = await readableDocsFromUrl(link, { titleHint: title });
          body = docs[0]?.body.slice(0, BODY_MAX) || body;
        }
      } catch {
        /* keep snippet */
      }
      const filer =
        pitchedByHint ||
        title.split(" - ")[0]?.trim() ||
        "SEC filer";
      out.push({
        source_type: form,
        source_name: sourceNameHint || "SEC EDGAR",
        pitched_by: filer,
        source_url: link,
        date: date || new Date().toISOString(),
        title,
        body: String(body).slice(0, BODY_MAX),
        default_country: "",
      });
    }
  } catch {
    /* skip */
  }
  return out;
}

export async function ingestSec(): Promise<IngestDocument[]> {
  const cfg = await loadJson<SecConfig>("config/sec.json");
  const urls = [
    ...(cfg.edgar_atom_urls ?? []),
    ...(cfg.edgar_atom_url ? [cfg.edgar_atom_url] : []),
  ];
  const batches = await Promise.all([
    ...urls.map((u) => ingestSecFeed(u, cfg)),
    ...(cfg.activist_ciks ?? []).map((a) =>
      ingestSecFeed(cikAtomUrl(a.cik), cfg, a.pitched_by, a.name),
    ),
  ]);
  const seen = new Set<string>();
  const out: IngestDocument[] = [];
  for (const doc of batches.flat()) {
    const key = doc.source_url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doc);
  }
  return out;
}

export async function ingestX(): Promise<IngestDocument[]> {
  const cfg = await loadJson<XConfig>("config/x-watchlist.json");
  const out: IngestDocument[] = [];
  for (const acct of cfg.accounts) {
    const handle = acct.handle.replace(/^@/, "");
    const feedUrl =
      acct.syndication_url ||
      `https://nitter.net/${handle}/rss`;
    try {
      const feed = await rss.parseURL(feedUrl);
      for (const item of feed.items.slice(0, 3)) {
        const link = item.link ?? feedUrl;
        const display = acct.display_name ?? acct.handle;
        out.push({
          source_type: "x",
          source_name: acct.handle.startsWith("@") ? acct.handle : `@${handle}`,
          pitched_by: display,
          source_url: link,
          date: item.isoDate ?? new Date().toISOString(),
          title: item.title ?? display,
          body: extractArticleText(
            String(item.contentSnippet ?? item.content ?? item.title ?? ""),
          ),
          default_country: "",
        });
      }
    } catch {
      /* best-effort skip */
    }
  }
  return out;
}

export async function ingestAllSources(): Promise<IngestDocument[]> {
  const batches = await Promise.all([
    ingestLetters(),
    ingestSubstack(),
    ingestSec(),
    ingestX(),
  ]);
  return batches.flat();
}
