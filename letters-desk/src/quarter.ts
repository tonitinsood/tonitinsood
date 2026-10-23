/** Quarter the letter discusses (quarter ending), not calendar quarter of publication date. */

export type QuarterHint = {
  date?: string;
  title?: string;
  text?: string;
  pdf_url?: string;
};

const QUARTER_WORD: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
};

/** Publication month → most recent completed calendar quarter (standard fund letter lag). */
export function quarterFromPublicationDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month >= 1 && month <= 3) return `Q4 ${year - 1}`;
  if (month <= 6) return `Q1 ${year}`;
  if (month <= 9) return `Q2 ${year}`;
  return `Q3 ${year}`;
}

function normalizeYear(raw: string): string {
  const y = raw.trim();
  if (/^\d{4}$/.test(y)) return y;
  if (/^\d{2}$/.test(y)) {
    const n = Number(y);
    return n >= 50 ? `19${y}` : `20${y}`;
  }
  return y;
}

/** Parse explicit Q3 2026 / 3Q26 / third quarter 2026 from title, URL, or letter head. */
export function parseExplicitQuarter(blob: string): string {
  const text = blob.slice(0, 8000);
  const patterns: { re: RegExp; pick: (m: RegExpMatchArray) => string }[] = [
    {
      re: /\b(?:for|through|ended|ending|period\s+to|as\s+of)\s+(?:the\s+)?(?:quarter\s+)?(?:ended\s+)?(?:on\s+)?(?:september|june|march|december)\s+\d{1,2},?\s+(\d{4})\b/i,
      pick: (m) => {
        const month = m[0].toLowerCase();
        const year = m[1]!;
        if (month.includes("march")) return `Q1 ${year}`;
        if (month.includes("june")) return `Q2 ${year}`;
        if (month.includes("september")) return `Q3 ${year}`;
        return `Q4 ${year}`;
      },
    },
    {
      re: /\b(?:third|fourth|first|second|1st|2nd|3rd|4th)\s+quarter(?:\s+of|\s+ended|\s+ending)?\s+(\d{4})\b/i,
      pick: (m) => {
        const word = m[0].match(/(first|second|third|fourth|1st|2nd|3rd|4th)/i)?.[1]?.toLowerCase() ?? "";
        const q = QUARTER_WORD[word];
        return q ? `Q${q} ${m[1]}` : "";
      },
    },
    {
      re: /\bQ([1-4])\s+(\d{4})\b/i,
      pick: (m) => `Q${m[1]} ${m[2]}`,
    },
    {
      re: /\b([1-4])Q\s+(\d{4})\b/i,
      pick: (m) => `Q${m[1]} ${m[2]}`,
    },
    {
      re: /([1-4])Q[_-](\d{4})/i,
      pick: (m) => `Q${m[1]} ${m[2]}`,
    },
    {
      re: /\b([1-4])Q(\d{2})\b/i,
      pick: (m) => `Q${m[1]} ${normalizeYear(m[2]!)}`,
    },
    {
      re: /([1-4])Q(\d{2})(?![0-9])/i,
      pick: (m) => `Q${m[1]} ${normalizeYear(m[2]!)}`,
    },
    {
      re: /[_-]([1-4])q-(\d{4})/i,
      pick: (m) => `Q${m[1]} ${m[2]}`,
    },
    {
      re: /[_-]([1-4])q(\d{2})\b/i,
      pick: (m) => `Q${m[1]} ${normalizeYear(m[2]!)}`,
    },
    {
      re: /\b([1-4])Q\s*['']?(\d{2,4})\b/i,
      pick: (m) => `Q${m[1]} ${normalizeYear(m[2]!)}`,
    },
  ];
  for (const { re, pick } of patterns) {
    const m = text.match(re);
    if (m) {
      const label = pick(m);
      if (label) return label;
    }
  }
  return "";
}

function parseSemiAnnual(blob: string, date: string): string {
  if (!/\bsemi[- ]?annual|half[- ]?year|mid[- ]?year|h1\b|h2\b|1st half|2nd half|first half|second half/i.test(blob)) {
    return "";
  }
  const year = date.match(/^(\d{4})/)?.[1] ?? "";
  if (!year) return "";
  if (/\bh2\b|2nd half|second half|half[- ]?year.*(?:second|2)/i.test(blob)) return `H2 ${year}`;
  return `H1 ${year}`;
}

/** Best label for the Quarter column: explicit period in text/URL/title, else publication lag rule. */
export function letterQuarter(hint: QuarterHint): string {
  const date = hint.date && /^\d{4}-\d{2}-\d{2}$/.test(hint.date) ? hint.date : "";
  const head = `${hint.title ?? ""} ${hint.pdf_url ?? ""}`;
  const explicitHead = parseExplicitQuarter(head);
  if (explicitHead) return explicitHead;
  const explicitBody = parseExplicitQuarter((hint.text ?? "").slice(0, 5000));
  if (explicitBody) return explicitBody;
  const semiBlob = `${head} ${(hint.text ?? "").slice(0, 2000)}`;
  const semi = date ? parseSemiAnnual(semiBlob, date) : "";
  if (semi) return semi;
  if (date) return quarterFromPublicationDate(date);
  return "";
}

/** @deprecated Use quarterFromPublicationDate or letterQuarter. Kept for tests migrating off calendar-quarter bug. */
export function quarterFromDate(iso: string): string {
  return quarterFromPublicationDate(iso);
}
