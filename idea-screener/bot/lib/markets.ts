import type { ExtractedPitch } from "./types.js";

/** Yahoo-style suffixes we treat as non-US listings. */
export const NON_US_SUFFIX: Record<string, string> = {
  T: "Japan",
  L: "UK",
  PA: "France",
  DE: "Germany",
  F: "Germany",
  NS: "India",
  BO: "India",
  AX: "Australia",
  TO: "Canada",
  V: "Canada",
  CN: "Canada",
  SA: "Brazil",
  MX: "Mexico",
  HK: "Hong Kong",
  SW: "Switzerland",
  AS: "Netherlands",
  MI: "Italy",
  BR: "Belgium",
  ST: "Sweden",
  CO: "Denmark",
  HE: "Finland",
  OL: "Norway",
  LS: "Portugal",
  MC: "Spain",
  IR: "Ireland",
  TW: "Taiwan",
  TWO: "Taiwan",
  KS: "Korea",
  KQ: "Korea",
  SS: "China",
  SZ: "China",
  SI: "Singapore",
  NZ: "New Zealand",
  JK: "Indonesia",
  KL: "Malaysia",
  JO: "South Africa",
};

/** Share-class suffixes that are still US listings (BRK.A, BF.B). */
const US_CLASS_SUFFIX = new Set(["A", "B", "C", "D", "PR", "WS", "W", "U", "UN"]);

export const PRIORITY_COUNTRIES = new Set([
  "Japan",
  "UK",
  "France",
  "Germany",
  "Europe",
  "India",
  "Australia",
  "Canada",
  "Brazil",
  "Mexico",
  "Hong Kong",
  "Switzerland",
  "Netherlands",
  "Italy",
  "Belgium",
  "Sweden",
  "Denmark",
  "Finland",
  "Norway",
  "Portugal",
  "Spain",
  "Ireland",
  "Taiwan",
  "Korea",
  "China",
  "Singapore",
  "New Zealand",
  "Indonesia",
  "Malaysia",
  "South Africa",
]);

export function inferRegion(ticker: string, fallback = ""): string {
  const t = ticker.trim().toUpperCase();
  if (!t.includes(".")) return fallback || "US";
  const suffix = t.split(".").pop() ?? "";
  if (NON_US_SUFFIX[suffix]) return NON_US_SUFFIX[suffix];
  if (US_CLASS_SUFFIX.has(suffix)) return fallback || "US";
  return fallback || suffix;
}

export function isNonUsListing(
  ticker: string,
  exchangeCountry: string,
): boolean {
  const country = (exchangeCountry || inferRegion(ticker)).trim();
  if (PRIORITY_COUNTRIES.has(country)) return true;
  if (!country || country.toUpperCase() === "US") return false;
  return country.toUpperCase() !== "US";
}

export function isUsListing(pitch: {
  ticker: string;
  exchange_country: string;
}): boolean {
  return !isNonUsListing(pitch.ticker, pitch.exchange_country);
}

/** Keep every non-US pitch; cap US so they do not crowd the sheet. */
export function rankAndCapPitches<T extends ExtractedPitch>(
  pitches: T[],
  maxUs = 6,
): T[] {
  const nonUs = pitches.filter((p) => isNonUsListing(p.ticker, p.exchange_country));
  const us = pitches.filter((p) => !isNonUsListing(p.ticker, p.exchange_country));
  const usCap = nonUs.length === 0 ? Math.max(maxUs, 8) : maxUs;
  return [...nonUs, ...us.slice(0, usCap)];
}
