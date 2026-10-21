import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import type { IngestDocument, SourceType } from "../types.js";
import { fetchText, stripHtml } from "./fetch.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../");

export type LettersConfig = {
  letters: { name: string; url: string; type: "pdf" | "html"; pitched_by?: string }[];
};
export type SubstackConfig = {
  substacks: { name: string; feed_url: string; pitched_by?: string }[];
};
export type SecConfig = {
  edgar_atom_url: string;
  keywords?: string[];
};
export type XConfig = {
  accounts: { handle: string; display_name?: string; syndication_url?: string }[];
};

const rss = new Parser({ timeout: 20_000 });

export async function loadJson<T>(rel: string): Promise<T> {
  const text = await readFile(path.join(root, rel), "utf8");
  return JSON.parse(text) as T;
}

export async function ingestLetters(): Promise<IngestDocument[]> {
  const cfg = await loadJson<LettersConfig>("config/letters.json");
  const out: IngestDocument[] = [];
  for (const letter of cfg.letters) {
    try {
      const raw = await fetchText(letter.url);
      const body =
        letter.type === "html" ? stripHtml(raw).slice(0, 80_000) : raw.slice(0, 80_000);
      out.push({
        source_type: "letter",
        source_name: letter.name,
        pitched_by: letter.pitched_by ?? letter.name,
        source_url: letter.url,
        date: new Date().toISOString().slice(0, 10),
        title: letter.name,
        body,
      });
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
      for (const item of feed.items.slice(0, 5)) {
        const link = item.link ?? pub.feed_url;
        let body = item.contentSnippet ?? item.content ?? item.summary ?? "";
        if (link) {
          try {
            const html = await fetchText(link);
            body = stripHtml(html).slice(0, 60_000) || body;
          } catch {
            /* keep snippet */
          }
        }
        const author = item.creator ?? item.author ?? pub.pitched_by ?? pub.name;
        out.push({
          source_type: "substack",
          source_name: pub.name,
          pitched_by: String(author),
          source_url: link,
          date: item.isoDate ?? new Date().toISOString(),
          title: item.title ?? pub.name,
          body: `${item.title ?? ""}\n\n${body}`.trim(),
        });
      }
    } catch {
      /* skip feed */
    }
  }
  return out;
}

function classifySecForm(title: string): SourceType | null {
  const t = title.toUpperCase();
  if (t.includes("SC 13D") || t.includes("13D")) return "sec_13d";
  if (t.includes("SC 13G") || t.includes("13G")) return "sec_13g";
  if (t.includes("8-K")) return "sec_8k";
  return null;
}

export async function ingestSec(): Promise<IngestDocument[]> {
  const cfg = await loadJson<SecConfig>("config/sec.json");
  const out: IngestDocument[] = [];
  try {
    const feed = await rss.parseURL(cfg.edgar_atom_url);
    for (const item of feed.items.slice(0, 20)) {
      const title = item.title ?? "";
      const form = classifySecForm(title);
      if (!form) continue;
      if (cfg.keywords?.length) {
        const blob = `${title} ${item.contentSnippet ?? ""}`.toLowerCase();
        if (!cfg.keywords.some((k) => blob.includes(k.toLowerCase()))) continue;
      }
      const link = item.link ?? cfg.edgar_atom_url;
      let body = item.contentSnippet ?? item.summary ?? title;
      try {
        if (link) {
          const html = await fetchText(link);
          body = stripHtml(html).slice(0, 60_000) || body;
        }
      } catch {
        /* keep snippet */
      }
      const filer = title.split(" - ")[0]?.trim() ?? "SEC filer";
      out.push({
        source_type: form,
        source_name: "SEC EDGAR",
        pitched_by: filer,
        source_url: link,
        date: item.isoDate ?? new Date().toISOString(),
        title,
        body,
      });
    }
  } catch {
    /* skip */
  }
  return out;
}

export async function ingestX(): Promise<IngestDocument[]> {
  const cfg = await loadJson<XConfig>("config/x-watchlist.json");
  const out: IngestDocument[] = [];
  for (const acct of cfg.accounts) {
    const feedUrl =
      acct.syndication_url ??
      `https://nitter.net/${acct.handle.replace(/^@/, "")}/rss`;
    try {
      const feed = await rss.parseURL(feedUrl);
      for (const item of feed.items.slice(0, 3)) {
        const link = item.link ?? feedUrl;
        const display = acct.display_name ?? acct.handle;
        out.push({
          source_type: "x",
          source_name: acct.handle,
          pitched_by: display,
          source_url: link,
          date: item.isoDate ?? new Date().toISOString(),
          title: item.title ?? display,
          body: item.contentSnippet ?? item.content ?? item.title ?? "",
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
