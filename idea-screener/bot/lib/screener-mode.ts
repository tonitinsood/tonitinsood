/** Daily caps vs exhaustive run (workflow_dispatch / SCREENER_EXHAUSTIVE=1). */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isExhaustiveScreen(override?: boolean): boolean {
  if (override === true) return true;
  if (override === false) return false;
  const raw = process.env.SCREENER_EXHAUSTIVE?.trim().toLowerCase();
  if (!raw) return false;
  return TRUTHY.has(raw);
}

export type IngestCaps = {
  letterRssDefault: number;
  substackDefault: number;
  secFeedItems: number;
  secMaxAgeDays: number;
  xPerAccount: number;
  maxUsPitches: number;
};

const DAILY: IngestCaps = {
  letterRssDefault: 6,
  substackDefault: 5,
  secFeedItems: 20,
  secMaxAgeDays: 14,
  xPerAccount: 3,
  maxUsPitches: 6,
};

/** ~4× daily caps, hard ceilings for GHA timeout (45m). */
const EXHAUSTIVE: IngestCaps = {
  letterRssDefault: 24,
  substackDefault: 20,
  secFeedItems: 60,
  secMaxAgeDays: 42,
  xPerAccount: 12,
  maxUsPitches: 24,
};

export function ingestCaps(exhaustive?: boolean): IngestCaps {
  return isExhaustiveScreen(exhaustive) ? EXHAUSTIVE : DAILY;
}

/** Per-config max_items: scale up in exhaustive mode but respect explicit low caps. */
export function scaledMaxItems(
  configured: number | undefined,
  fallback: number,
  exhaustive?: boolean,
): number {
  const base = configured ?? fallback;
  if (!isExhaustiveScreen(exhaustive)) return base;
  return Math.min(Math.max(base, fallback) * 4, fallback * 5);
}

export function fmpThrottleMs(exhaustive?: boolean): number {
  return isExhaustiveScreen(exhaustive) ? 200 : 0;
}