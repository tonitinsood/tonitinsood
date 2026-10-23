import { findTickers, isJunkTicker } from "../../idea-screener/bot/lib/extract-heuristic.js";

/** Agencies, jargon, doc types, currencies, periods — never equities. */
export const TICKER_DENY = new Set([
  "DOJ",
  "FBI",
  "CIA",
  "NSA",
  "DNI",
  "FDA",
  "FTC",
  "SEC",
  "CFTC",
  "FDIC",
  "OCC",
  "ECB",
  "IMF",
  "OECD",
  "NATO",
  "WHO",
  "CDC",
  "IRS",
  "HMRC",
  "UN",
  "EU",
  "UK",
  "USA",
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "CIO",
  "CAO",
  "CMO",
  "CHRO",
  "ETF",
  "ETN",
  "ETP",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "INR",
  "GDP",
  "CPI",
  "PPI",
  "PCE",
  "NFP",
  "PMI",
  "AI",
  "ML",
  "NLP",
  "LLM",
  "FAQ",
  "PDF",
  "HTML",
  "HTTP",
  "HTTPS",
  "LLC",
  "INC",
  "LTD",
  "PLC",
  "LLP",
  "LP",
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "H1",
  "H2",
  "FY",
  "YTD",
  "YOY",
  "QOQ",
  "MOM",
  "TTM",
  "ESG",
  "CSR",
  "GHG",
  "EAC",
  "PPA",
  "MENA",
  "APAC",
  "EMEA",
  "WWF",
  "NGO",
  "IPO",
  "SPAC",
  "NAV",
  "AUM",
  "IRR",
  "ROE",
  "ROA",
  "ROI",
  "ROIC",
  "PE",
  "PB",
  "EV",
  "EPS",
  "FCF",
  "EBIT",
  "EBITDA",
  "CAGR",
  "GICS",
  "IBES",
  "MSCI",
  "FTSE",
  "SPX",
  "NDX",
  "NYSE",
  "NASDAQ",
  "AMEX",
  "LSE",
  "TSX",
  "HKEX",
  "ASX",
  "GFC",
  "SSI",
  "FDI",
  "CTV",
  "DCF",
  "SOTP",
  "WACC",
  "CAPM",
  "NIM",
  "NPA",
  "CETI",
  "CET1",
  "CASA",
  "CSB",
  "FCL",
  "BIAL",
  "FIRV",
  "RRI",
  "MGU",
  "NPA",
  "KPI",
  "SLA",
  "NDA",
  "MOU",
  "VAT",
  "GST",
  "APR",
  "APR",
  "GAAP",
  "IFRS",
  "FASB",
  "TCFD",
  "SASB",
  "ISSB",
  "SBTi",
  "THE",
  "AND",
  "FOR",
  "SEE",
  "NEW",
  "ALL",
  "TO",
  "HFP",
  "BIAC",
  "CEE",
  "CIB",
  "OBBA",
]);

const EXCHANGE_PREFIX =
  /^(?:NYSE|NASDAQ|AMEX|TSX|LSE|TSE|ASX|NSE|BSE|HKEX|TYO|EPA|FRA|SWX|SGX|KRX|OSE)[:\s-]+/i;

const SUFFIX_RE =
  /^[A-Z0-9]{2,5}\.(?:T|L|PA|DE|F|NS|BO|AX|TO|V|CN|SA|MX|HK|SW|AS|MI|BR|ST|CO|HE|OL|LS|MC|IR|TW|TWO|KS|KQ|SS|SZ|SI|NZ|JK|KL|JO)$/;

const COMPANY_NEAR_TICKER =
  /\b(Inc|Incorporated|Corp|Corporation|Ltd|Limited|LLC|PLC|AG|SA|NV|SE|KK|Holdings|Group|Company|Co|KGaA|plc)\b\.?/i;

/** Small set of well-known listed names that often appear unmarked. */
const EQUITY_ALLOW = new Set([
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOG",
  "GOOGL",
  "META",
  "NVDA",
  "TSLA",
  "BRK",
  "BRK.B",
  "BRK.A",
  "JPM",
  "UNH",
  "XOM",
  "JNJ",
  "V",
  "MA",
  "WMT",
  "PG",
  "KO",
  "PEP",
  "DIS",
  "NFLX",
  "AMD",
  "INTC",
  "ORCL",
  "ADBE",
  "CRM",
  "AVGO",
  "TSM",
  "ASML",
  "NVO",
  "NESN",
  "NOVN",
  "ROG",
  "SAP",
  "SHEL",
  "BP",
  "TTE",
  "RY",
  "TD",
  "BMO",
  "BNS",
  "FFH",
  "LSEG",
  "MC.PA",
  "OR.PA",
  "LVMH",
]);

export type TickerKind = "dollar" | "exchange" | "suffix" | "paren" | "bare";

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(EXCHANGE_PREFIX, "");
}

export function isDeniedTicker(ticker: string): boolean {
  const t = normalizeTicker(ticker);
  if (!t) return true;
  if (isJunkTicker(t)) return true;
  if (TICKER_DENY.has(t)) return true;
  if (/^[A-Z]\.[A-Z]$/.test(t)) return true;
  const head = t.split(".")[0] ?? t;
  if (t.includes(".") && SUFFIX_RE.test(t)) return false;
  if (TICKER_DENY.has(head)) return true;
  return false;
}

export function isExchangeQualified(ticker: string, kind?: TickerKind): boolean {
  if (kind === "dollar" || kind === "exchange" || kind === "suffix") return true;
  return SUFFIX_RE.test(ticker) || ticker.startsWith("$") || EXCHANGE_PREFIX.test(ticker);
}

function companyContextOk(text: string, ticker: string): boolean {
  const escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `([A-Z][A-Za-z0-9&.'\\-]+(?:\\s+[A-Z][A-Za-z0-9&.'\\-]+){0,6})\\s*\\(\\s*\\$?${escaped}\\s*\\)`,
  );
  const m = text.match(re);
  if (!m?.[1]) return false;
  return COMPANY_NEAR_TICKER.test(m[1]);
}

/** Real equity tickers only. Unqualified 2–4 letter tokens need allow/heuristic. */
export function isEquityTicker(
  raw: string,
  opts: { kind?: TickerKind; text?: string } = {},
): boolean {
  const t = normalizeTicker(raw);
  if (!t || isDeniedTicker(t)) return false;
  const head = t.split(".")[0] ?? t;
  if (head.length < 2) return false;
  if (SUFFIX_RE.test(t) && head.length >= 2) return true;
  if (opts.kind === "dollar" || opts.kind === "exchange") return true;
  if (EQUITY_ALLOW.has(t) || EQUITY_ALLOW.has(head)) return true;
  if (opts.kind === "paren" && opts.text && companyContextOk(opts.text, t)) return true;
  if (t.length >= 5 && /[A-Z]{2,}/.test(t)) return true;
  return false;
}

const HOLDINGS_SECTION_RE =
  /(?:top\s+(?:\d+\s+)?holdings?|portfolio\s+(?:holdings|composition|activity)|(?:new|final)\s+(?:purchases|sales)|largest\s+positions?|contributors?\s+(?:and|&)\s+detractors?)[\s\S]{0,12000}/gi;

const COMMA_TICKER_LINE =
  /^[\s•\-–—*]*((?:[A-Z]{1,5}(?:\.[A-Z]{1,3})?|[A-Z0-9]{2,5}\.(?:T|L|TO|DE|HK|KS|PA|AX|SW|MI))(?:\s*[,;|]\s*(?:[A-Z]{1,5}(?:\.[A-Z]{1,3})?|[A-Z0-9]{2,5}\.(?:T|L|TO|DE|HK|KS|PA|AX|SW|MI))){2,})\s*$/gm;

function extractHoldingsBlockTickers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind: TickerKind) => {
    const t = raw.toUpperCase();
    if (!t || seen.has(t) || !isEquityTicker(t, { kind, text })) return;
    seen.add(t);
    out.push(t);
  };
  for (const block of text.matchAll(HOLDINGS_SECTION_RE)) {
    const slice = block[0] ?? "";
    for (const m of slice.matchAll(COMMA_TICKER_LINE)) {
      const parts = (m[1] ?? "").split(/\s*[,;|]\s*/);
      for (const p of parts) push(p.trim(), "bare");
    }
    for (const m of slice.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g)) {
      push(m[1]!, "dollar");
    }
    for (const m of slice.matchAll(
      /\b([A-Z0-9]{2,5}\.(?:T|L|PA|DE|F|NS|BO|AX|TO|V|CN|SA|MX|HK|SW|AS|MI|BR|ST|CO|HE|OL|LS|MC|IR|TW|TWO|KS|KQ|SS|SZ|SI|NZ|JK|KL|JO))\b/g,
    )) {
      push(m[1]!, "suffix");
    }
  }
  return out;
}

export function extractEquityTickers(text: string, limit = 24): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined, kind: TickerKind) => {
    const t = raw?.toUpperCase();
    if (!t || seen.has(t) || !isEquityTicker(t, { kind, text })) return;
    seen.add(t);
    out.push(t);
  };
  for (const t of extractHoldingsBlockTickers(text)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of findTickers(text)) {
    push(t, t.includes(".") ? "suffix" : "bare");
  }
  for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g)) {
    push(m[1], "dollar");
  }
  for (const m of text.matchAll(
    /\b(?:NYSE|NASDAQ|AMEX|TSX|LSE|TSE|ASX|NSE|BSE|HKEX|TYO|EPA|FRA|SWX|SGX|KRX|OSE)[:\s-]+([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g,
  )) {
    push(m[1], "exchange");
  }
  for (const m of text.matchAll(
    /\b([A-Z0-9]{2,5}\.(?:T|L|PA|DE|F|NS|BO|AX|TO|V|CN|SA|MX|HK|SW|AS|MI|BR|ST|CO|HE|OL|LS|MC|IR|TW|TWO|KS|KQ|SS|SZ|SI|NZ|JK|KL|JO))\b/g,
  )) {
    push(m[1], "suffix");
  }
  for (const m of text.matchAll(/\(\s*([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\s*\)/g)) {
    push(m[1], "paren");
  }
  return out.slice(0, limit);
}
