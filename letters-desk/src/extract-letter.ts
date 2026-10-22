import {
  extractPitchesHeuristic,
  findTickers,
  isJunkTicker,
} from "../../idea-screener/bot/lib/extract-heuristic.js";
import { inferRegion } from "../../idea-screener/bot/lib/markets.js";
import { looksUnreadable, sanitizeText } from "../../idea-screener/bot/lib/ingest/readable.js";
import type { FundConfig, LetterPitch, LetterRecord, SeedLetter, Stance } from "./types.js";

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const THEME_RULES: { theme: string; re: RegExp }[] = [
  { theme: "value", re: /\b(intrinsic value|margin of safety|undervalued|cheap(?:er)? than|valuation)\b/i },
  { theme: "quality", re: /\b(high quality|moat|durable competitive|compounders?|quality compound)\b/i },
  { theme: "growth", re: /\b(secular growth|high growth|reinvestment)\b/i },
  { theme: "AI", re: /\b(artificial intelligence|\bAI\b|machine learning|LLM|ChatGPT|OpenAI)\b/i },
  { theme: "bubble", re: /\b(bubble|speculat(?:e|ion|ive)|mania|this time is different)\b/i },
  { theme: "China", re: /\b(China|Chinese|Beijing|renminbi|yuan)\b/i },
  { theme: "Japan", re: /\b(Japan|Japanese|yen|Tokyo|Nikkei)\b/i },
  { theme: "Europe", re: /\b(Europe|European|eurozone|UK stock|sterling)\b/i },
  { theme: "emerging markets", re: /\b(emerging markets?|EM equities|developing world)\b/i },
  { theme: "buybacks", re: /\b(share buybacks?|repurchases?|treasury shares)\b/i },
  { theme: "capital allocation", re: /\b(capital allocation|return of capital|dividends? and buybacks)\b/i },
  { theme: "credit", re: /\b(credit cycle|distressed|high yield|default cycle)\b/i },
  { theme: "insurance", re: /\b(underwriting|combined ratio|float|premiums written)\b/i },
  { theme: "rates", re: /\b(interest rates?|bond yields?|Fed |central bank)\b/i },
  { theme: "energy", re: /\b(oil price|natural gas|energy transition|OPEC)\b/i },
  { theme: "healthcare", re: /\b(pharma(?:ceutical)?|biotech|healthcare|GLP-1)\b/i },
  { theme: "consumer", re: /\b(consumer staples|luxury|branded consumer)\b/i },
  { theme: "compounding", re: /\b(compound(?:ing)?|owner.?earnings|long-term returns?)\b/i },
  { theme: "US exceptionalism", re: /\b(US exceptionalism|S&P 500|American unexceptionalism)\b/i },
  { theme: "activism", re: /\b(activist|letter to the board|board seat)\b/i },
];

const CAP_RULES: { cap: string; re: RegExp }[] = [
  { cap: "mega", re: /\b(mega-?cap|magnificent (?:7|seven)|largest companies)\b/i },
  { cap: "large", re: /\b(large-?cap|blue chip)\b/i },
  { cap: "mid", re: /\b(mid-?cap|smid)\b/i },
  { cap: "small", re: /\b(small-?cap|smaller compan(?:y|ies))\b/i },
];

const MAX_QUICK = 780;
const MAX_PITCH = 3200;

/** Extra junk that parenthetical extract treats as tickers in letters. */
const LETTER_TICKER_STOP = new Set([
  "GICS",
  "IBES",
  "ESG",
  "CAGR",
  "GFC",
  "SSI",
  "FDI",
  "CTV",
  "OBBA",
  "NET",
  "TO",
  "MC",
  "PA",
  "HFP",
  "BIAC",
  "CEE",
  "CIB",
  "CPI",
  "PPI",
  "YOY",
  "QOQ",
  "DCF",
  "SOTP",
  "WACC",
  "CAPM",
  "MSCI",
  "FTSE",
  "S&P",
  "SPX",
  "NDX",
]);

export function quarterFromDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const year = m[1]!;
  const month = Number(m[2]);
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `Q${q} ${year}`;
}

export function parseLetterDate(text: string, fallback: string): string {
  const head = text.slice(0, 2500);
  const q = head.match(/\b(?:([1-4])Q|Q([1-4]))\s+(\d{4})\b/i);
  if (q) {
    const n = Number(q[1] || q[2]);
    const year = q[3]!;
    const month = String(n * 3).padStart(2, "0");
    const day = n === 1 ? "31" : n === 2 ? "30" : n === 3 ? "30" : "31";
    return `${year}-${month}-${day}`;
  }
  const named = head.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (named) {
    const mm = MONTHS[named[1]!.toLowerCase()] ?? "01";
    return `${named[3]}-${mm}-${named[2]!.padStart(2, "0")}`;
  }
  const monthYear = head.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (monthYear) {
    const mm = MONTHS[monthYear[1]!.toLowerCase()] ?? "01";
    return `${monthYear[2]}-${mm}-01`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : fallback || "";
}

export function extractThemes(text: string): string[] {
  const out: string[] = [];
  for (const rule of THEME_RULES) {
    if (rule.re.test(text) && !out.includes(rule.theme)) out.push(rule.theme);
    if (out.length >= 8) break;
  }
  return out;
}

export function inferCap(text: string): string {
  for (const rule of CAP_RULES) {
    if (rule.re.test(text)) return rule.cap;
  }
  return "";
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+(?=[A-Z“"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30);
}

export function extractQuickTake(text: string): string {
  if (looksUnreadable(text)) return "";
  const body = sanitizeText(text).replace(/^[\s\S]{0,1200}?(Dear [^\n.]{0,80}[,.])/i, "$1");
  const picked: string[] = [];
  for (const sentence of splitSentences(body)) {
    if (
      /dear (?:fellow )?(?:investor|shareholder)|table below|% total return|past performance|not a (?:recommendation|offer)|copyright|all rights reserved|confidential|authorised and regulated|issued and approved|©\s*\d{4}|oaktree capital management/i.test(
        sentence,
      )
    ) {
      continue;
    }
    if (/page \d+ of \d+|click here|unsubscribe/i.test(sentence)) continue;
    picked.push(sentence);
    if (picked.length >= 4 || picked.join(" ").length >= MAX_QUICK) break;
  }
  const take = picked.join(" ").trim();
  if (take.length >= 80) return take.slice(0, MAX_QUICK);
  const fallback = sanitizeText(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 60 && !/^dear /i.test(l))
    .slice(0, 4)
    .join(" ");
  return fallback.slice(0, MAX_QUICK);
}

export function isLetterJunkTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (!t || isJunkTicker(t) || LETTER_TICKER_STOP.has(t)) return true;
  if (t.length <= 2 && !t.includes(".")) return true;
  return false;
}

function strictTickers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const t = raw?.toUpperCase();
    if (!t || isLetterJunkTicker(t) || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g)) push(m[1]);
  for (const m of text.matchAll(
    /\b(?:NYSE|NASDAQ|AMEX|TSX|LSE|TSE|ASX|NSE|BSE|HKEX|TYO|EPA|FRA)[:\s-]+([A-Z]{1,5}(?:\.[A-Z]{1,3})?)\b/g,
  )) {
    push(m[1]);
  }
  for (const m of text.matchAll(
    /\b([A-Z0-9]{1,5}\.(?:T|L|PA|DE|F|NS|BO|AX|TO|V|CN|SA|MX|HK|SW|AS|MI|BR|ST|CO|HE|OL|LS|MC|IR|TW|TWO|KS|KQ|SS|SZ|SI|NZ|JK|KL|JO))\b/g,
  )) {
    push(m[1]);
  }
  return out.slice(0, 12);
}

function inferStance(text: string): Stance {
  const slice = text.slice(0, 1500);
  const shortHit = /\b(we (?:are )?short|short position|our short|going short)\b/i.test(slice);
  const longHit =
    /\b(we (?:are )?long|we (?:bought|purchased|added|own)|our (?:long )?position|going long)\b/i.test(
      slice,
    );
  if (shortHit && !longHit) return "short";
  if (longHit) return "long";
  return "unknown";
}

function clipPitch(writeup: string, letterLen: number): string {
  let body = sanitizeText(writeup);
  if (looksUnreadable(body) || body.includes("%PDF")) {
    return "";
  }
  if (letterLen > 6000 && body.length > Math.min(letterLen * 0.45, MAX_PITCH + 500)) {
    body = body.slice(0, MAX_PITCH);
  }
  if (body.length > MAX_PITCH) body = `${body.slice(0, MAX_PITCH).trim()}…`;
  return body;
}

export function pitchesFromLetter(
  text: string,
  fund: FundConfig,
  seed: SeedLetter,
): LetterPitch[] {
  const doc = {
    source_type: "letter" as const,
    source_name: fund.name,
    pitched_by: seed.manager || fund.manager,
    source_url: seed.pdf_url,
    date: seed.date,
    title: seed.title,
    body: text,
    default_country: fund.region === "US" ? "" : fund.region,
  };
  const extracted = extractPitchesHeuristic(doc);
  const letterLen = text.length;
  const out: LetterPitch[] = [];
  const seen = new Set<string>();
  for (const p of extracted) {
    const writeup = clipPitch(p.full_pitch || p.thesis_short, letterLen);
    if (!writeup || writeup.length < 80) continue;
    if (writeup.length > letterLen * 0.8 && letterLen > 4000) continue;
    const ticker = p.ticker.toUpperCase();
    if (ticker && isLetterJunkTicker(ticker)) continue;
    const company = p.company.trim();
    if (!ticker && (!company || company.toLowerCase() === seed.title.toLowerCase())) continue;
    if (!ticker && company.length > 60) continue;
    if (!ticker && writeup.length >= MAX_PITCH - 20) continue;
    const key = `${ticker}|${company.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stance = inferStance(`${p.thesis_short}\n${writeup}`);
    out.push({
      stance: stance === "unknown" ? "long" : stance,
      ticker: p.ticker,
      company: p.company,
      country: p.exchange_country,
      writeup,
      pe: "",
      ev_ebit: "",
      roic: "",
      net_debt_ebitda: "",
      metrics_source: "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function collectTickers(text: string, pitches: LetterPitch[]): string[] {
  const fromText = [
    ...strictTickers(text),
    ...findTickers(text).filter((t) => !isLetterJunkTicker(t) && t.length >= 3),
  ];
  const fromPitches = pitches
    .map((p) => p.ticker)
    .filter((t) => t && !isLetterJunkTicker(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...fromPitches, ...fromText]) {
    const up = t.toUpperCase();
    if (!up || seen.has(up) || isLetterJunkTicker(up)) continue;
    seen.add(up);
    out.push(up);
    if (out.length >= 12) break;
  }
  return out;
}

export function geosFor(fund: FundConfig, tickers: string[], pitches: LetterPitch[]): string {
  const parts = new Set<string>();
  if (fund.region) parts.add(fund.region);
  for (const p of pitches) {
    if (p.country) parts.add(p.country);
  }
  for (const t of tickers) {
    const r = inferRegion(t, "");
    if (r) parts.add(r);
  }
  return [...parts].slice(0, 4).join(", ");
}

export function heuristicLetter(
  text: string,
  fund: FundConfig,
  seed: SeedLetter,
): LetterRecord {
  const clean = sanitizeText(text);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(seed.date)
    ? seed.date
    : parseLetterDate(clean, seed.date);
  const pitches = pitchesFromLetter(clean, fund, seed);
  const tickers = collectTickers(clean, pitches);
  return {
    id: seed.id,
    date,
    quarter: quarterFromDate(date),
    fund_id: fund.id,
    fund: fund.name,
    manager: seed.manager || fund.manager,
    title: seed.title,
    region: fund.region,
    geo: geosFor(fund, tickers, pitches),
    cap: inferCap(clean),
    tickers,
    themes: extractThemes(clean),
    quick_take: extractQuickTake(clean),
    pitches,
    pdf_url: seed.pdf_url,
    pdf_local: `pdfs/${seed.id}.pdf`,
    source_url: seed.pdf_url,
    extract_method: "heuristic",
  };
}

export function mergeLlmIntoHeuristic(
  base: LetterRecord,
  llm: Partial<LetterRecord> | null,
): LetterRecord {
  if (!llm) return base;
  const tickers = (llm.tickers ?? [])
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t && !isJunkTicker(t));
  const pitches = (llm.pitches ?? [])
    .map((p) => ({
      ...p,
      ticker: (p.ticker || "").toUpperCase(),
      writeup: clipPitch(p.writeup || "", 20_000),
      pe: p.pe ?? "",
      ev_ebit: p.ev_ebit ?? "",
      roic: p.roic ?? "",
      net_debt_ebitda: p.net_debt_ebitda ?? "",
      metrics_source: p.metrics_source ?? "",
    }))
    .filter((p) => p.writeup.length >= 80 && p.writeup.length < 12_000);
  return {
    ...base,
    manager: llm.manager?.trim() || base.manager,
    title: llm.title?.trim() || base.title,
    date: llm.date && /^\d{4}-\d{2}-\d{2}$/.test(llm.date) ? llm.date : base.date,
    quarter:
      llm.date && /^\d{4}-\d{2}-\d{2}$/.test(llm.date)
        ? quarterFromDate(llm.date)
        : base.quarter,
    tickers: tickers.length ? tickers.slice(0, 12) : base.tickers,
    themes: llm.themes?.length ? llm.themes.slice(0, 8) : base.themes,
    quick_take:
      llm.quick_take && llm.quick_take.length >= 60
        ? llm.quick_take.slice(0, MAX_QUICK)
        : base.quick_take,
    geo: llm.geo?.trim() || base.geo,
    cap: llm.cap?.trim() || base.cap,
    pitches: pitches.length ? pitches.slice(0, 8) : base.pitches,
    extract_method: "llm",
  };
}
