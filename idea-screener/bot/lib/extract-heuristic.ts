import type { ExtractedPitch, IngestDocument } from "./types.js";

const TICKER_RE =
  /\b(?:NYSE|NASDAQ|TSX|LSE|TSE)?\s*\$?([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g;

export function extractPitchesHeuristic(doc: IngestDocument): ExtractedPitch[] {
  const tickers = findTickers(`${doc.title}\n${doc.body}`.slice(0, 120_000));
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
        thesis_short: doc.title.slice(0, 280),
        full_pitch: doc.body.slice(0, 100_000),
        source_url: doc.source_url,
      },
    ];
  }
  const thesis =
    doc.body.slice(0, 400).trim() ||
    doc.title ||
    "See full_pitch for narrative.";
  return tickers.slice(0, 5).map((ticker) => ({
    date: doc.date.slice(0, 10),
    source_type: doc.source_type,
    source_name: doc.source_name,
    pitched_by: doc.pitched_by,
    ticker,
    exchange_country: inferRegion(ticker),
    company: "",
    thesis_short: thesis.slice(0, 500),
    full_pitch: doc.body.slice(0, 100_000),
    source_url: doc.source_url,
  }));
}

function findTickers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TICKER_RE)) {
    const t = m[1]?.toUpperCase();
    if (!t || t.length < 2) continue;
    if (["USD", "ETF", "CEO", "CFO", "IPO", "AI", "IT"].includes(t)) continue;
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
