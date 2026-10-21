import { thesisFromBody } from "./ingest/readable.js";
import type { ExtractedPitch, IngestDocument } from "./types.js";

const TICKER_RE =
  /\b(?:NYSE|NASDAQ|TSX|LSE|TSE)?\s*\$?([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g;

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
  "CEO",
  "CFO",
  "COO",
  "IPO",
  "AI",
  "IT",
  "US",
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
]);

export function isJunkTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (!t) return true;
  if (TICKER_STOPLIST.has(t)) return true;
  if (t.length === 1) return true;
  return false;
}

export function extractPitchesHeuristic(doc: IngestDocument): ExtractedPitch[] {
  const blob = `${doc.title}\n${doc.body}`.slice(0, 120_000);
  const tickers = findTickers(blob);
  const thesis = thesisFromBody(doc.title, doc.body);
  const fullPitch = doc.body.slice(0, 100_000);
  if (tickers.length === 0) {
    return [
      {
        date: doc.date.slice(0, 10),
        source_type: doc.source_type,
        source_name: doc.source_name,
        pitched_by: doc.pitched_by,
        ticker: "",
        exchange_country: "",
        company: "",
        thesis_short: thesis,
        full_pitch: fullPitch,
        source_url: doc.source_url,
      },
    ];
  }
  return tickers.slice(0, 5).map((ticker) => ({
    date: doc.date.slice(0, 10),
    source_type: doc.source_type,
    source_name: doc.source_name,
    pitched_by: doc.pitched_by,
    ticker,
    exchange_country: inferRegion(ticker),
    company: "",
    thesis_short: thesis,
    full_pitch: fullPitch,
    source_url: doc.source_url,
  }));
}

export function findTickers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TICKER_RE)) {
    const t = m[1]?.toUpperCase();
    if (!t) continue;
    if (isJunkTicker(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function inferRegion(ticker: string): string {
  if (!ticker.includes(".")) return "US";
  const suffix = ticker.split(".").pop()?.toUpperCase();
  const map: Record<string, string> = {
    T: "Japan",
    L: "UK",
    PA: "France",
    DE: "Germany",
    NS: "India",
    BO: "India",
    AX: "Australia",
    TO: "Canada",
    SA: "Brazil",
    MX: "Mexico",
  };
  return map[suffix ?? ""] ?? suffix ?? "";
}
