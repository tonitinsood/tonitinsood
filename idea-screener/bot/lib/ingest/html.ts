import { looksLikePageChrome, sanitizeText } from "./readable.js";

/** Decode common + numeric HTML entities, including double-encoded GTM blobs. */
export function decodeHtmlEntities(html: string): string {
  let prev = "";
  let cur = html;
  for (let i = 0; i < 3 && cur !== prev; i++) {
    prev = cur;
    cur = cur
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&rsquo;/gi, "'")
      .replace(/&lsquo;/gi, "'")
      .replace(/&rdquo;/gi, '"')
      .replace(/&ldquo;/gi, '"')
      .replace(/&mdash;/gi, "—")
      .replace(/&ndash;/gi, "–")
      .replace(/&hellip;/gi, "...")
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
        const code = parseInt(n, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      });
  }
  return cur;
}

function dropChromeTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");
}

function htmlToText(html: string): string {
  const withBreaks = dropChromeTags(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return sanitizeText(decodeHtmlEntities(withBreaks));
}

function firstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && m[1].length > 80) return m[1];
  }
  return undefined;
}

/** Prefer article/filing body over nav, cookie banners, and Substack chrome. */
export function extractArticleText(html: string, titleHint = ""): string {
  const decoded = decodeHtmlEntities(html);
  const chunk =
    firstMatch(decoded, [
      /<div class="available-content">([\s\S]*?)(?:<div class="subscription-widget-wrap|<div class="paywall)/i,
      /<div class="body markup"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<article\b[^>]*>([\s\S]*?)<\/article>/i,
      /<main\b[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]+class="[^"]*(?:post-body|article-body|entry-content|rich-text|filing-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ]) ?? decoded;
  const dropLine =
    /^(PDF Translations|Japanese|Korean|Simplified Chinese|Traditional Chinese|Listen to Memo|Archived Memos|Subscribe|PDF \(English\))$/i;
  let text = htmlToText(chunk)
    .replace(/Opens in a new window/gi, "")
    .replace(/Opens an external site(?: in a new window)?/gi, "")
    .replace(/Subscribe Sign in/gi, "")
    .split("\n")
    .filter((line) => !dropLine.test(line.trim()))
    .join("\n")
    .trim();
  if (
    titleHint &&
    !text.toLowerCase().startsWith(titleHint.toLowerCase().slice(0, 40))
  ) {
    text = `${titleHint}\n\n${text}`;
  }
  return sanitizeText(text);
}

export function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og?.[1]) return decodeHtmlEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(t?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(href: string, baseUrl: string): string | undefined {
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}

/** Child memo/article/PDF URLs from a listing/hub page. */
export function discoverChildUrls(html: string, baseUrl: string): string[] {
  const decoded = decodeHtmlEntities(html);
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (href: string) => {
    const abs = absUrl(href.replace(/[<>"].*$/, ""), baseUrl);
    if (!abs) return;
    const key = abs.split("?")[0]!.toLowerCase();
    if (seen.has(key)) return;
    if (/podcast|audio|video|youtube|bloomberg\.com\/news\/videos/i.test(abs)) {
      return;
    }
    seen.add(key);
    found.push(abs);
  };

  for (const m of decoded.matchAll(/\/insights\/memo\/[a-z0-9][a-z0-9\-]+/gi)) {
    push(m[0]);
  }
  for (const m of decoded.matchAll(
    /https?:\/\/[^\s"'<>]+\/(?:memos|letters|filings)\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi,
  )) {
    push(m[0].replace(/&quot;.*$/, "").replace(/&amp;.*$/, ""));
  }
  for (const m of decoded.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) {
    const href = m[1] ?? "";
    if (/\/memos\/|\/letters\//i.test(href)) push(href);
  }
  return found.slice(0, 8);
}

/** SEC index pages: prefer the actual filing .htm/.txt over the wrapper. */
export function discoverSecFilingUrl(
  html: string,
  baseUrl: string,
): string | undefined {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => m[1] ?? "",
  );
  for (const href of hrefs) {
    if (!/\.(htm|html|txt)(?:$|\?)/i.test(href)) continue;
    if (/index\.|header\.|xslF/i.test(href)) continue;
    if (!/\/Archives\/edgar\//i.test(href) && !/\.txt$/i.test(href)) continue;
    const abs = absUrl(href, baseUrl);
    if (abs) return abs;
  }
  return undefined;
}

export function isHubPage(html: string, articleText: string): boolean {
  const children = discoverChildUrls(html, "https://example.com/");
  if (children.length >= 3 && articleText.length < 3500) return true;
  if (looksLikePageChrome(articleText) && children.length >= 2) return true;
  if (/Memos From Howard Marks/i.test(html) && children.length >= 1) return true;
  return false;
}
