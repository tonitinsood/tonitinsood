import type { FundConfig, LetterRecord, SeedLetter } from "./types.js";

/** PDF identity: host + path, no www, query, or hash. */
export function canonicalPdfUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (u.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    return `${u.protocol}//${host}${path}`;
  } catch {
    return raw.split(/[?#]/)[0]!.toLowerCase().replace(/\/+$/, "");
  }
}

export function pdfBasename(url: string): string {
  const path = canonicalPdfUrl(url).split("/").pop() ?? "";
  return decodeURIComponent(path.replace(/\.pdf$/i, "")).toLowerCase();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function letterIdentityKey(letter: {
  fund_id?: string;
  fund?: string;
  date: string;
  title: string;
}): string {
  const fund = (letter.fund_id || letter.fund || "").trim().toLowerCase();
  return `${fund}|${letter.date}|${normalizeTitle(letter.title)}`;
}

function isGenericTitle(title: string, fundName?: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  if (fundName && t === `${fundName.trim().toLowerCase()} letter`) return true;
  return /^(letter|memo|pdf|document)$/i.test(t);
}

function scoreLetter(letter: LetterRecord): number {
  let n = 0;
  n += letter.pitches.length * 4;
  n += letter.tickers.length;
  if (!isGenericTitle(letter.title, letter.fund)) n += 8;
  if (letter.extract_method === "llm") n += 2;
  if (!/-(?:new|undated)-/.test(letter.id)) n += 3;
  return n;
}

function prefer(a: LetterRecord, b: LetterRecord): LetterRecord {
  const sa = scoreLetter(a);
  const sb = scoreLetter(b);
  if (sa !== sb) return sa >= sb ? a : b;
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/** Collapse clones: same PDF URL first, then same fund + date + title. */
export function dedupeLetters(letters: LetterRecord[]): LetterRecord[] {
  const byUrl = new Map<string, LetterRecord>();
  const noUrl: LetterRecord[] = [];
  for (const letter of letters) {
    const url = canonicalPdfUrl(letter.pdf_url || letter.source_url);
    if (!url) {
      noUrl.push(letter);
      continue;
    }
    const prev = byUrl.get(url);
    byUrl.set(url, prev ? prefer(prev, letter) : letter);
  }
  const byIdentity = new Map<string, LetterRecord>();
  for (const letter of [...byUrl.values(), ...noUrl]) {
    const identity = letterIdentityKey(letter);
    const generic = isGenericTitle(letter.title, letter.fund);
    if (!letter.date || generic) {
      const fallback = `id:${letter.id}`;
      if (!byIdentity.has(fallback)) byIdentity.set(fallback, letter);
      continue;
    }
    const prev = byIdentity.get(identity);
    byIdentity.set(identity, prev ? prefer(prev, letter) : letter);
  }
  return [...byIdentity.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.fund.localeCompare(b.fund) || a.id.localeCompare(b.id),
  );
}

export function dedupeSeedLetters(letters: SeedLetter[]): SeedLetter[] {
  const byUrl = new Map<string, SeedLetter>();
  const byIdentity = new Map<string, SeedLetter>();
  for (const seed of letters) {
    const url = canonicalPdfUrl(seed.pdf_url);
    if (url) {
      if (byUrl.has(url)) continue;
      byUrl.set(url, seed);
    }
    const identity = `${seed.date}|${normalizeTitle(seed.title)}`;
    if (seed.date && seed.title && byIdentity.has(identity)) continue;
    if (seed.date && seed.title) byIdentity.set(identity, seed);
  }
  const keep = new Set<SeedLetter>();
  for (const seed of byUrl.values()) keep.add(seed);
  for (const seed of byIdentity.values()) keep.add(seed);
  return letters.filter((s) => keep.has(s) || (!canonicalPdfUrl(s.pdf_url) && !s.date));
}

export function knownPdfKeys(fund: FundConfig, extraUrls: string[] = []): Set<string> {
  const keys = new Set<string>();
  const add = (url: string) => {
    const canon = canonicalPdfUrl(url);
    if (canon) keys.add(canon);
    const base = pdfBasename(url);
    if (base) keys.add(`name:${base}`);
  };
  for (const letter of fund.letters) add(letter.pdf_url);
  for (const url of extraUrls) add(url);
  return keys;
}

export function isKnownPdf(url: string, known: Set<string>): boolean {
  const canon = canonicalPdfUrl(url);
  if (canon && (known.has(canon) || known.has(url) || known.has(url.split("?")[0]!.toLowerCase()))) {
    return true;
  }
  const base = pdfBasename(url);
  return Boolean(base && known.has(`name:${base}`));
}
