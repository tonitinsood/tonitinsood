import {
  extractPitchesHeuristic,
} from "../../idea-screener/bot/lib/extract-heuristic.js";
import { inferRegion } from "../../idea-screener/bot/lib/markets.js";
import { looksUnreadable, sanitizeText } from "../../idea-screener/bot/lib/ingest/readable.js";
import { extractEquityTickers, isDeniedTicker, isEquityTicker } from "./tickers.js";
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

const MAX_PITCH = 3200;

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

export function isGenericLetterTitle(title: string, fundName?: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  if (fundName && t === `${fundName.trim().toLowerCase()} letter`) return true;
  return /^(letter|memo|pdf|document|untitled)$/i.test(t);
}

export function extractLetterTitle(text: string, fallback: string, fundName?: string): string {
  if (fallback && !isGenericLetterTitle(fallback, fundName)) return fallback;
  const lines = sanitizeText(text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && l.length <= 120);
  for (const line of lines.slice(0, 40)) {
    if (/^dear |^to (?:our |the )?(?:fellow )?(?:shareholders|investors)/i.test(line)) continue;
    if (/page \d+|copyright|confidential|authorised and regulated|all rights reserved/i.test(line)) {
      continue;
    }
    if (/%PDF|http|:\/\//i.test(line)) continue;
    if (/[.]$/.test(line) && line.split(/\s+/).length >= 6) continue;
    if (/^[A-Z0-9][A-Za-z0-9 ,:'’&().?!\-]{7,90}$/.test(line)) {
      return line;
    }
  }
  return fallback;
}

export function isLetterJunkTicker(ticker: string): boolean {
  return isDeniedTicker(ticker);
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
    if (ticker && !isEquityTicker(ticker, { kind: ticker.includes(".") ? "suffix" : "bare", text })) {
      if (!p.company.trim()) continue;
    }
    const company = p.company.trim();
    if (!ticker && (!company || company.toLowerCase() === seed.title.toLowerCase())) continue;
    if (!ticker && company.length > 60) continue;
    if (!ticker && writeup.length >= MAX_PITCH - 20) continue;
    const cleanTicker =
      ticker && isEquityTicker(ticker, { kind: ticker.includes(".") ? "suffix" : "paren", text })
        ? ticker
        : "";
    const key = `${cleanTicker}|${company.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stance = inferStance(`${p.thesis_short}\n${writeup}`);
    out.push({
      stance: stance === "unknown" ? "long" : stance,
      ticker: cleanTicker,
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
  const fromText = extractEquityTickers(text, 12);
  const fromPitches = pitches
    .map((p) => p.ticker)
    .filter((t) => t && isEquityTicker(t, { kind: t.includes(".") ? "suffix" : "bare", text }));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...fromPitches, ...fromText]) {
    const up = t.toUpperCase();
    if (!up || seen.has(up) || isDeniedTicker(up)) continue;
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
  const title = extractLetterTitle(clean, seed.title, fund.name);
  const pitches = pitchesFromLetter(clean, fund, { ...seed, title, date });
  const tickers = collectTickers(clean, pitches);
  return {
    id: seed.id,
    date,
    quarter: quarterFromDate(date),
    fund_id: fund.id,
    fund: fund.name,
    manager: seed.manager || fund.manager,
    title,
    region: fund.region,
    geo: geosFor(fund, tickers, pitches),
    cap: inferCap(clean),
    tickers,
    themes: extractThemes(clean),
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
    .filter((t) => isEquityTicker(t, { kind: t.includes(".") ? "suffix" : "bare" }));
  const pitches = (llm.pitches ?? [])
    .map((p) => ({
      ...p,
      ticker: isEquityTicker((p.ticker || "").toUpperCase(), {
        kind: (p.ticker || "").includes(".") ? "suffix" : "bare",
      })
        ? (p.ticker || "").toUpperCase()
        : "",
      writeup: clipPitch(p.writeup || "", 20_000),
      pe: p.pe ?? "",
      ev_ebit: p.ev_ebit ?? "",
      roic: p.roic ?? "",
      net_debt_ebitda: p.net_debt_ebitda ?? "",
      metrics_source: p.metrics_source ?? "",
    }))
    .filter((p) => p.writeup.length >= 80 && p.writeup.length < 12_000);
  const date = llm.date && /^\d{4}-\d{2}-\d{2}$/.test(llm.date) ? llm.date : base.date;
  const title =
    llm.title?.trim() && !isGenericLetterTitle(llm.title, base.fund)
      ? llm.title.trim()
      : base.title;
  return {
    ...base,
    manager: llm.manager?.trim() || base.manager,
    title,
    date,
    quarter: quarterFromDate(date),
    tickers: tickers.length ? tickers.slice(0, 12) : base.tickers,
    themes: llm.themes?.length ? llm.themes.slice(0, 8) : base.themes,
    geo: llm.geo?.trim() || base.geo,
    cap: llm.cap?.trim() || base.cap,
    pitches: pitches.length ? pitches.slice(0, 8) : base.pitches,
    extract_method: "llm",
  };
}
