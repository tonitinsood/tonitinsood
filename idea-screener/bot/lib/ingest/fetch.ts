import {
  extractArticleText,
  extractTitle,
  discoverChildUrls,
  discoverSecFilingUrl,
  isHubPage,
} from "./html.js";
import { extractPdfText, isPdfMagic } from "./pdf.js";
import {
  looksUnreadable,
  sanitizeText,
  unreadableNote,
} from "./readable.js";

const DEFAULT_MAX_BYTES = 8_000_000;
const UA =
  "Mozilla/5.0 (compatible; idea-screener/1.0; +https://github.com/tonitinsood/tonitinsood)";

export type FetchedBytes = {
  url: string;
  contentType: string;
  bytes: Buffer;
};

export type ReadableDoc = {
  source_url: string;
  title: string;
  body: string;
  kind: "pdf" | "html" | "text" | "unreadable";
};

export async function fetchBytes(
  url: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<FetchedBytes> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const bytes = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
  const contentType = res.headers.get("content-type") ?? "";
  const finalUrl = res.url || url;
  return { url: finalUrl, contentType, bytes };
}

function isPdf(fetched: FetchedBytes): boolean {
  return /application\/pdf/i.test(fetched.contentType) || isPdfMagic(fetched.bytes);
}

function isHtml(fetched: FetchedBytes): boolean {
  if (/text\/html|application\/xhtml/i.test(fetched.contentType)) return true;
  const head = fetched.bytes.subarray(0, 200).toString("utf8").trimStart();
  return head.startsWith("<!") || head.startsWith("<html") || head.startsWith("<HTML");
}

async function pdfDoc(url: string, bytes: Buffer, titleHint: string): Promise<ReadableDoc> {
  const extracted = sanitizeText(await extractPdfText(bytes));
  if (!extracted || looksUnreadable(extracted) || extracted.length < 80) {
    return {
      source_url: url,
      title: titleHint,
      body: unreadableNote(
        url,
        extracted.length < 80
          ? "scanned or image-only PDF"
          : "PDF text was unreadable",
      ),
      kind: "unreadable",
    };
  }
  return {
    source_url: url,
    title: titleHint || extracted.slice(0, 80),
    body: extracted.slice(0, 100_000),
    kind: "pdf",
  };
}

function htmlString(bytes: Buffer): string {
  // Prefer UTF-8; fall back to latin1 if the page is a legacy filing.
  const utf8 = bytes.toString("utf8");
  if ((utf8.match(/\uFFFD/g)?.length ?? 0) > 50) {
    return bytes.toString("latin1");
  }
  return utf8;
}

/**
 * Fetch a URL and return one or more human-readable documents.
 * Listing/hub pages (followHub) expand to child memos/PDFs instead of nav chrome.
 */
export async function readableDocsFromUrl(
  url: string,
  opts: { followHub?: boolean; titleHint?: string; depth?: number } = {},
): Promise<ReadableDoc[]> {
  const depth = opts.depth ?? 0;
  const titleHint = opts.titleHint ?? "";
  let fetched: FetchedBytes;
  try {
    fetched = await fetchBytes(url);
  } catch {
    return [
      {
        source_url: url,
        title: titleHint,
        body: unreadableNote(url, "fetch failed"),
        kind: "unreadable",
      },
    ];
  }

  if (isPdf(fetched)) {
    return [await pdfDoc(fetched.url, fetched.bytes, titleHint)];
  }

  if (isHtml(fetched)) {
    const html = htmlString(fetched.bytes);
    const title = extractTitle(html) || titleHint;
    const article = extractArticleText(html, "").slice(0, 100_000);

    if (depth === 0) {
      const sec = discoverSecFilingUrl(html, fetched.url);
      if (sec && sec !== fetched.url) {
        return readableDocsFromUrl(sec, {
          followHub: false,
          titleHint: title,
          depth: 1,
        });
      }
    }

    if (opts.followHub && depth === 0 && isHubPage(html, article)) {
      const children = discoverChildUrls(html, fetched.url).slice(0, 5);
      const nested: ReadableDoc[] = [];
      for (const child of children) {
        const docs = await readableDocsFromUrl(child, {
          followHub: false,
          titleHint: titleHint || title,
          depth: 1,
        });
        nested.push(...docs);
      }
      if (nested.some((d) => d.kind !== "unreadable")) {
        return nested.filter((d) => d.kind !== "unreadable");
      }
    }

    // Teaser HTML with a memo PDF: prefer the PDF body.
    if (depth < 2 && article.length < 2500) {
      const pdfs = discoverChildUrls(html, fetched.url).filter((u) =>
        /\.pdf(?:$|\?)/i.test(u),
      );
      const memoPdf = pdfs.find((u) => /\/memos\/|\/letters\//i.test(u)) ?? pdfs[0];
      if (memoPdf) {
        const docs = await readableDocsFromUrl(memoPdf, {
          followHub: false,
          titleHint: title,
          depth: depth + 1,
        });
        if (docs[0] && docs[0].kind !== "unreadable") return docs;
      }
    }

    const body =
      !article || looksUnreadable(article)
        ? unreadableNote(fetched.url, "HTML had no readable article body")
        : article;
    return [
      {
        source_url: fetched.url,
        title,
        body,
        kind: looksUnreadable(body) ? "unreadable" : "html",
      },
    ];
  }

  const text = sanitizeText(fetched.bytes.toString("utf8"));
  if (looksUnreadable(text)) {
    return [
      {
        source_url: fetched.url,
        title: titleHint,
        body: unreadableNote(fetched.url, "unsupported or binary content"),
        kind: "unreadable",
      },
    ];
  }
  return [
    {
      source_url: fetched.url,
      title: titleHint,
      body: text.slice(0, 100_000),
      kind: "text",
    },
  ];
}

/** Back-compat: one readable string (never raw PDF bytes). */
export async function fetchText(url: string, _maxBytes = 500_000): Promise<string> {
  const docs = await readableDocsFromUrl(url, { followHub: false });
  return docs[0]?.body ?? "";
}

export function stripHtml(html: string): string {
  return extractArticleText(html);
}
