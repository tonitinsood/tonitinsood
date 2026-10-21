import { thesisFromBody, looksUnreadable } from "./ingest/readable.js";
import { inferRegion } from "./markets.js";
import type { ExtractedPitch, IngestDocument, SourceType } from "./types.js";

/** Tokens the old regex treated as tickers (PDF objects, nav, jargon). */
export const TICKER_STOPLIST = new Set([
  "PDF",
  "EOF",
  "OBJ",
  "END",
  "ID",
  "XREF",
  "STREAM",
  "FILTER",
  "TYPE",
  "FONT",
  "PAGE",
  "PAGES",
  "HTML",
  "HTTP",
  "HTTPS",
  "WWW",
  "CSS",
  "GTM",
  "RSS",
  "XML",
  "API",
  "URL",
  "JSON",
  "LLC",
  "INC",
  "LTD",
  "PLC",
  "LLP",
  "SICAV",
  "ETF",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "INR",
  "BRL",
  "MXN",
  "CEO",
  "CFO",
  "COO",
  "IPO",
  "AI",
  "IT",
  "US",
  "U.S",
  "UK",
  "EU",
  "USA",
  "GB",
  "FC",
  "RL",
  "PD",
  "AJ",
  "MW",
  "ML",
  "AM",
  "PM",
  "GDP",
  "EPS",
  "EBIT",
  "PE",
  "EV",
  "ROIC",
  "FCF",
  "IRR",
  "GPU",
  "CPU",
  "TPU",
  "XPU",
  "HBM",
  "AWS",
  "TCO",
  "BOM",
  "MFU",
  "JAX",
  "THE",
  "AND",
  "FOR",
  "SEE",
  "NEW",
  "ALL",
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "YOY",
  "TTM",
  "NAV",
  "AUM",
  "SEC",
  "NYSE",
  "NASDAQ",
  "GAAP",
  "FASB",
  "AMEX",
  "UTC",
  "CPA",
  "SLURM",
  "FLOPS",
  "NCCL",
  "ASIC",
  "WFE",
  "LLM",
  "AGI",
  "TB",
  "ASE",
  "EFA",
  "ENA",
  "SRE",
  "CMD",
  "KPI",
  "YTD",
  "MOM",
  "QOQ",
]);

const THESIS_RE =
  /\b(undervalued|overvalued|mispriced|intrinsic value|margin of safety|investment thesis|bear case|bull case|catalysts?|price target|target price|we (?:are )?(?:long|short)|going long|going short|initiate[d]?(?: a)? (?:buy|long|short|position)|buy rating|strong buy|conviction (?:buy|short)|activist|purpose of (?:the )?transaction|board (?:seat|representation)|tender offer|sum[- ]of[- ]the[- ]parts|free cash flow yield|recommend(?:ed)? (?:buying|selling|shorting)|should (?:i|we) buy|worth buying|attractive (?:entry|valuation)|upside of|take[- ]private|share (?:buybacks?|repurchases?)|net[- ]net|deep dive|stock idea|investment idea|why (?:i'?m|we are) (?:long|short|buying)|initiating coverage|absolute steal|tipped to (?:rise|rally)|heading to|not a buy yet|time to buy|we (?:bought|purchased|acquired|added)|beneficial ownership|letter to (?:the )?board)\b/i;

const GENERAL_LETTER_RE =
  /\b(to the shareholders of|dear (?:fellow )?shareholders|chairm[ae]n'?s letter|in memoriam|passed away|died on|obituar(?:y|ies)|quarterly (?:letter|update) to (?:our )?(?:lps?|investors)|market commentary|macro (?:outlook|memo))\b/i;

const IDEA_TITLE_RE =
  /\b(investment idea|stock idea|deep dive|activist|why (?:i'?m|we are) (?:long|short|buying)|initiating coverage|take[- ]private|not a buy yet|time to buy|upside)\b/i;

const ISSUER_RE =
  /name of issuer[:\s]+([^\n]+)/i;
const SYMBOL_RE =
  /(?:trading[\s-]*symbol|ticker[\s-]*symbol)[:\s]+["']?([A-Z]{1,5}(?:\.[A-Z]{1,3})?)/i;

const EXCHANGE_PREFIX_COUNTRY: Record<string, string> = {
  NYSE: "US",
  NASDAQ: "US",
  AMEX: "US",
  TSX: "Canada",
  LSE: "UK",
  TSE: "Japan",
  TYO: "Japan",
  ASX: "Australia",
  NSE: "India",
  BSE: "India",
  HKEX: "Hong Kong",
  EPA: "France",
  FRA: "Germany",
};

const TICKER_MARKED_RE =
  /(?:(\$)|(NYSE|NASDAQ|AMEX|TSX|LSE|TSE|ASX|NSE|BSE|HKEX|TYO|EPA|FRA)[:\s-]*)([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g;

const TICKER_SUFFIX_RE =
  /\b([A-Z0-9]{1,5}\.(?:T|L|PA|DE|F|NS|BO|AX|TO|V|CN|SA|MX|HK|SW|AS|MI|BR|ST|CO|HE|OL|LS|MC|IR|TW|TWO|KS|KQ|SS|SZ|SI|NZ|JK|KL|JO))\b/g;

const TICKER_PAREN_RE =
  /\(\s*([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\s*\)/g;

type PitchCandidate = {
  ticker: string;
  company: string;
  country: string;
  section: string;
  index: number;
};

export function isJunkTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (!t) return true;
  if (TICKER_STOPLIST.has(t)) return true;
  if (t.length === 1) return true;
  return false;
}

export function hasThesisLanguage(text: string): boolean {
  return THESIS_RE.test(text);
}

export function looksLikeGeneralLetter(text: string, sourceType?: SourceType): boolean {
  if (sourceType?.startsWith("sec_")) return false;
  return GENERAL_LETTER_RE.test(text.slice(0, 2_000));
}

const JUNK_SEED_SOURCE =
  /berkshire hathaway|howard marks|oaktree|baupost|semianalysis|net interest/i;

/** Existing sheet rows from the old letter dump should be dropped. */
export function isJunkSeedRow(row: {
  source_name: string;
  source_url: string;
  source_type: string;
}): boolean {
  return (
    JUNK_SEED_SOURCE.test(row.source_name) ||
    JUNK_SEED_SOURCE.test(row.source_url)
  );
}

export function isConcretePitch(pitch: {
  ticker: string;
  company: string;
  thesis_short: string;
  full_pitch: string;
  source_type: SourceType;
}): boolean {
  const named = Boolean(pitch.ticker.trim() || looksLikeCompanyName(pitch.company));
  if (!named) return false;
  if (pitch.ticker && isJunkTicker(pitch.ticker) && !looksLikeCompanyName(pitch.company)) return false;
  const blob = `${pitch.thesis_short}\n${pitch.full_pitch}`;
  if (looksUnreadable(pitch.full_pitch)) return false;
  if (looksLikeGeneralLetter(blob, pitch.source_type) && !hasThesisLanguage(blob)) {
    return false;
  }
  if (pitch.source_type === "sec_13d" || pitch.source_type === "sec_13g") {
    return true;
  }
  return hasThesisLanguage(blob) || IDEA_TITLE_RE.test(pitch.thesis_short);
}

/**
 * Emit one row per named stock pitch. Skip letters, commentary, obituaries,
 * and fund updates that do not argue a specific ticker or company.
 */
export function extractPitchesHeuristic(doc: IngestDocument): ExtractedPitch[] {
  const blob = `${doc.title}\n${doc.body}`.slice(0, 400_000);
  if (looksUnreadable(doc.body) && !doc.title.trim()) return [];
  if (looksLikeGeneralLetter(blob, doc.source_type) && !hasThesisLanguage(blob)) {
    return [];
  }

  const candidates = mergeCandidates(findPitchCandidates(doc, blob));
  const out: ExtractedPitch[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (c.company && !looksLikeCompanyName(c.company)) c.company = "";
    if (!c.ticker && !c.company) continue;
    const key = `${c.ticker}|${c.company.toLowerCase()}`;
    if (seen.has(key)) continue;
    const section = (c.section || blob).trim();
    if (!isPitchNarrative(section, doc.source_type, doc.title)) continue;
    seen.add(key);
    const ticker = c.ticker.toUpperCase();
    const country = ticker
      ? c.country ||
        inferRegion(
          ticker,
          ticker.includes(".") ? doc.default_country || "" : "",
        )
      : c.country || doc.default_country || "";
    const pitch: ExtractedPitch = {
      date: doc.date.slice(0, 10),
      source_type: doc.source_type,
      source_name: doc.source_name,
      pitched_by: doc.pitched_by,
      ticker,
      exchange_country: country,
      company: c.company,
      thesis_short: thesisFromBody(c.company || ticker || doc.title, section),
      full_pitch: section,
      source_url: doc.source_url,
    };
    if (!isConcretePitch(pitch)) continue;
    out.push(pitch);
  }
  return out;
}

function isPitchNarrative(
  text: string,
  sourceType: SourceType,
  title: string,
): boolean {
  if (/getty images|claim your free|you.re reading a free article/i.test(text.slice(0, 400))) {
    if (!IDEA_TITLE_RE.test(title) && !/\$[A-Z]{1,5}\b/.test(text.slice(0, 800))) {
      // Motley Fool chrome / listicles without a tight idea headline
      if (!hasThesisLanguage(title) && /budget hit|free copy|premium investing/i.test(text)) {
        return false;
      }
    }
  }
  if (sourceType === "sec_13d") return true;
  if (sourceType === "sec_13g" && (hasThesisLanguage(text) || ISSUER_RE.test(text))) {
    return true;
  }
  if (IDEA_TITLE_RE.test(title) && text.trim().length > 120) return true;
  return hasThesisLanguage(text);
}

function mergeCandidates(cands: PitchCandidate[]): PitchCandidate[] {
  const byTicker = new Map<string, PitchCandidate>();
  const noTicker: PitchCandidate[] = [];
  for (const c of cands) {
    if (c.ticker) {
      const prev = byTicker.get(c.ticker);
      if (!prev) {
        byTicker.set(c.ticker, { ...c });
        continue;
      }
      if (c.company && !prev.company) prev.company = c.company;
      if (c.section.length < prev.section.length && c.section.length >= 200) {
        prev.section = c.section;
        prev.index = c.index;
      }
    } else if (c.company) {
      noTicker.push(c);
    }
  }
  const tickers = [...byTicker.values()];
  const extra: PitchCandidate[] = [];
  for (const c of noTicker) {
    const name = c.company.toLowerCase();
    const host = tickers.find(
      (t) =>
        (t.company &&
          (t.company.toLowerCase().includes(name.slice(0, 12)) ||
            name.includes(t.company.toLowerCase().slice(0, 12)))) ||
        t.section.toLowerCase().includes(name),
    );
    if (host) {
      if (!host.company) host.company = c.company;
      continue;
    }
    extra.push(c);
  }
  return [...tickers, ...extra];
}

function findPitchCandidates(doc: IngestDocument, blob: string): PitchCandidate[] {
  const fromSec = candidatesFromSec(doc, blob);
  const fromTickers = findMarkedTickerHits(blob).map((hit) => {
    const index = indexOfTicker(blob, hit.ticker);
    return {
      ticker: hit.ticker,
      company: companyNear(blob, hit.ticker, index),
      country:
        hit.country ||
        inferRegion(
          hit.ticker,
          hit.ticker.includes(".") ? doc.default_country || "" : "",
        ),
      section: sectionAround(blob, index, hit.ticker),
      index,
    };
  });

  const fromTitle = candidatesFromTitle(doc, blob);
  const merged = [...fromSec, ...fromTickers, ...fromTitle];
  if (merged.length > 0) return merged.slice(0, 12);

  // Single-name idea title with thesis body but no ticker markers.
  if (IDEA_TITLE_RE.test(doc.title) && hasThesisLanguage(blob)) {
    const company = companyFromTitle(doc.title);
    if (company) {
      return [
        {
          ticker: "",
          company,
          country: doc.default_country || "",
          section: blob,
          index: 0,
        },
      ];
    }
  }
  return [];
}

function candidatesFromSec(doc: IngestDocument, blob: string): PitchCandidate[] {
  if (!doc.source_type.startsWith("sec_")) return [];
  const issuer = (blob.match(ISSUER_RE)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const symbolRaw = blob.match(SYMBOL_RE)?.[1] ?? "";
  const symbol = symbolRaw && !isJunkTicker(symbolRaw) ? symbolRaw.toUpperCase() : "";
  const fromTitle = companyFromSecTitle(doc.title);
  const company = cleanCompany(issuer || fromTitle.company);
  const ticker = symbol || fromTitle.ticker;
  if (!company && !ticker) return [];
  const item4 = extractItem4(blob);
  return [
    {
      ticker,
      company,
      country: inferRegion(ticker, doc.default_country || fromTitle.country),
      section: item4 || blob,
      index: 0,
    },
  ];
}

function candidatesFromTitle(doc: IngestDocument, blob: string): PitchCandidate[] {
  const title = doc.title;
  if (!title.trim()) return [];
  const hits = findMarkedTickerHits(title);
  const company = companyFromTitle(title);
  if (hits.length === 0 && !company) return [];
  if (hits.length === 0 && company) {
    if (!IDEA_TITLE_RE.test(title) && !hasThesisLanguage(blob)) return [];
    return [
      {
        ticker: "",
        company,
        country: doc.default_country || "",
        section: blob,
        index: 0,
      },
    ];
  }
  return hits.map((hit) => ({
    ticker: hit.ticker,
    company: company || companyNear(blob, hit.ticker, 0),
    country:
      hit.country ||
      inferRegion(
        hit.ticker,
        hit.ticker.includes(".") ? doc.default_country || "" : "",
      ),
    section: blob,
    index: 0,
  }));
}

export function findTickers(text: string): string[] {
  return findMarkedTickers(text);
}

function findMarkedTickers(text: string): string[] {
  return findMarkedTickerHits(text).map((h) => h.ticker);
}

function findMarkedTickerHits(
  text: string,
): { ticker: string; country: string }[] {
  const seen = new Set<string>();
  const out: { ticker: string; country: string }[] = [];
  const push = (raw: string | undefined, country: string) => {
    const t = raw?.toUpperCase();
    if (!t || isJunkTicker(t) || seen.has(t)) return;
    seen.add(t);
    out.push({ ticker: t, country });
  };
  for (const m of text.matchAll(TICKER_MARKED_RE)) {
    const country = m[1]
      ? "US"
      : EXCHANGE_PREFIX_COUNTRY[(m[2] ?? "").toUpperCase()] || "";
    push(m[3], country);
  }
  for (const m of text.matchAll(TICKER_SUFFIX_RE)) {
    push(m[1], inferRegion(m[1] ?? ""));
  }
  for (const m of text.matchAll(TICKER_PAREN_RE)) {
    const t = m[1]?.toUpperCase() ?? "";
    if (t.length >= 2 && t.length <= 5) push(t, inferRegion(t));
  }
  return out;
}

function indexOfTicker(text: string, ticker: string): number {
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\$?${escaped}\\b`);
  const m = re.exec(text);
  return m ? m.index : 0;
}

function sectionAround(text: string, index: number, needle: string): string {
  const paras = text.split(/\n{2,}/);
  if (paras.length > 1) {
    const hit = paras.find((p) => p.toUpperCase().includes(needle.toUpperCase()));
    if (hit && hit.trim().length >= 120) return hit.trim();
  }
  const paraStart = text.lastIndexOf("\n\n", index);
  const paraEnd = text.indexOf("\n\n", index + needle.length);
  let start = paraStart >= 0 ? paraStart + 2 : Math.max(0, index - 3_500);
  let end = paraEnd >= 0 ? paraEnd : Math.min(text.length, index + 3_500);
  let slice = text.slice(start, end).trim();
  if (slice.length < 280) {
    slice = text
      .slice(Math.max(0, start - 1_500), Math.min(text.length, end + 1_500))
      .trim();
  }
  if (slice.length < 200) return text;
  return slice;
}

function companyNear(text: string, ticker: string, index: number): string {
  const window = text.slice(Math.max(0, index - 180), Math.min(text.length, index + 80));
  const beside = window.match(
    /([A-Z][A-Za-z0-9&.\-']+(?:\s+[A-Z][A-Za-z0-9&.\-']+){0,6})\s*\(\s*\$?[A-Z0-9][A-Z0-9.]{0,8}\s*\)/,
  );
  if (beside?.[1]) return cleanCompany(beside[1]);
  const patterned = window.match(
    /([A-Z][A-Za-z0-9&.\-']+(?:\s+[A-Z][A-Za-z0-9&.\-']+){0,6})\s+(?:Inc|Corp|Ltd|PLC|AG|SA|SE|NV|KK|Co|Group|KGaA|Holdings|plc|Limited)\.?/,
  );
  if (patterned?.[0] && looksLikeCompanyName(patterned[0])) {
    return cleanCompany(patterned[0]);
  }
  const before = window.split("$")[0] ?? window;
  const named = before.match(/([A-Z][A-Za-z0-9&.\-']+(?:\s+[A-Z][A-Za-z0-9&.\-']+){0,4})\s*$/);
  const guess = named?.[1] ? cleanCompany(named[1]) : "";
  return looksLikeCompanyName(guess) ? guess : "";
}

export function companyFromTitle(title: string): string {
  const dollar = title.match(
    /^(.{2,80}?)\s*\(\s*\$?[A-Z]{1,5}(?:\.[A-Z]{1,3})?\s*\)/,
  );
  if (dollar?.[1]) return cleanCompany(dollar[1]);
  const idea = title.match(
    /investment idea\s*#?\d*\s*[-–:]\s*([^,:(]+)/i,
  );
  if (idea?.[1]) return cleanCompany(idea[1]);
  const split = title.split(/\s[-–—|:]\s/)[0] ?? title;
  const cleaned = cleanCompany(split.replace(/\b(CMD|update|analysis|review)\b/gi, ""));
  if (
    /^(updates?|some links|market|weekly|letter|memo|links|\d{4})\b/i.test(cleaned) ||
    /letter to shareholders/i.test(cleaned)
  ) {
    return "";
  }
  if (!looksLikeCompanyName(cleaned)) return "";
  return cleaned;
}

export function looksLikeCompanyName(company: string): boolean {
  const c = company.trim();
  if (c.length < 2 || c.length > 70) return false;
  if (!/[A-Za-z]/.test(c)) return false;
  if (/\bhappenings\b/i.test(c)) return false;
  if (/\b(letter to shareholders|market commentary|weekly roundup|activists? list)\b/i.test(c)) {
    return false;
  }
  if (/^(claim|subscribe|free copy|getty images)\b/i.test(c)) return false;
  if ((c.match(/,/g) ?? []).length >= 2) return false;
  if ((c.match(/\s+/g) ?? []).length > 8) return false;
  return true;
}

function companyFromSecTitle(title: string): {
  company: string;
  ticker: string;
  country: string;
} {
  const issuer = title.match(
    /(?:13D\/?A?|13G\/?A?|8-K)\s*[-–]\s*([^(]+)/i,
  );
  const filer = title.match(/^([^(]+)\s*\(\d+\)/);
  const tickerMatch = title.match(/\(([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\)/);
  const ticker =
    tickerMatch && !isJunkTicker(tickerMatch[1] ?? "")
      ? (tickerMatch[1] ?? "").toUpperCase()
      : "";
  return {
    company: cleanCompany(issuer?.[1] || filer?.[1] || ""),
    ticker,
    country: "",
  };
}

function extractItem4(text: string): string {
  const m = text.match(
    /item\s*4[\s.:-]+purpose of (?:the )?transaction([\s\S]{200,20000}?)(?=item\s*5[\s.:-]|$)/i,
  );
  return m ? `Item 4. Purpose of Transaction\n${m[1].trim()}` : "";
}

function cleanCompany(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:|,]+|[\s\-–—:|,]+$/g, "")
    .replace(/\s+\((?:filer|issuer|reporting)\)$/i, "")
    .trim();
}
