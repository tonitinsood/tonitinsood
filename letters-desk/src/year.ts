/** Desk publishes 2026 letters only — not 2025 annuals that happen to be posted in 2026. */

export type YearHint = {
  id?: string;
  title?: string;
  date?: string;
  pdf_url?: string;
};

function yearsIn(text: string): string[] {
  return [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]!);
}

function isPre2026AnnualTitle(title: string): boolean {
  if (/\b2026\b/.test(title) && /semi|half|h1|h2|q[1-4]|[1-4]q/i.test(title)) {
    return false;
  }
  if (/\b2024\b/.test(title)) return true;
  return (
    /\b2025\b/.test(title) &&
    /annual|year.?end|chairman|shareholders.?letter/i.test(title)
  );
}

/** True when title/date already prove this is a 2024/2025 (or earlier) letter. */
export function isRejectedPre2026(input: YearHint): boolean {
  const title = input.title ?? "";
  const date = input.date ?? "";
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < "2026-01-01") return true;
  if (isPre2026AnnualTitle(title)) return true;
  const titleYears = yearsIn(title);
  if (titleYears.some((y) => y < "2026") && !titleYears.includes("2026")) return true;
  const idYears = yearsIn(input.id ?? "");
  if (idYears.some((y) => y < "2026") && !idYears.includes("2026") && !titleYears.includes("2026")) {
    if (date && date >= "2026-01-01") return false;
    return true;
  }
  return false;
}

export function isCalendar2026Letter(input: YearHint): boolean {
  if (isRejectedPre2026(input)) return false;
  const blob = `${input.id ?? ""} ${input.title ?? ""} ${input.date ?? ""} ${input.pdf_url ?? ""}`;
  if (/\b2026\b/.test(blob)) return true;
  const date = input.date ?? "";
  return Boolean(date && date >= "2026-01-01");
}
