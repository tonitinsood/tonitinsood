import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MetricSnapshot } from "./types.js";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/metrics.py",
);

export async function fetchMetricsFmp(
  ticker: string,
  apiKey: string,
): Promise<MetricSnapshot | null> {
  const sym = ticker.toUpperCase();
  const base = "https://financialmodelingprep.com/api/v3";
  try {
    const [ratiosRes, kmRes, profileRes] = await Promise.all([
      fetch(`${base}/ratios-ttm/${encodeURIComponent(sym)}?apikey=${apiKey}`),
      fetch(`${base}/key-metrics-ttm/${encodeURIComponent(sym)}?apikey=${apiKey}`),
      fetch(`${base}/profile/${encodeURIComponent(sym)}?apikey=${apiKey}`),
    ]);
    if (ratiosRes.status === 402 || kmRes.status === 402) return null;
    if (!ratiosRes.ok && !kmRes.ok) return null;
    const ratios = (await ratiosRes.json()) as Record<string, unknown>[];
    const km = (await kmRes.json()) as Record<string, unknown>[];
    const profile = profileRes.ok
      ? ((await profileRes.json()) as Record<string, unknown>[])
      : [];
    const r0 = ratios[0] ?? {};
    const k0 = km[0] ?? {};
    const pe = numStr(r0.priceEarningsRatioTTM ?? r0.peRatioTTM);
    const roic = numStr(k0.roicTTM ?? r0.returnOnCapitalEmployedTTM);
    const netDebtEbitda = numStr(k0.netDebtToEBITDATTM ?? r0.netDebtToEBITDATTM);
    let evEbit = numStr(k0.enterpriseValueOverEBITTTM);
    if (!evEbit && profile[0]) {
      const ev = num(profile[0].enterpriseValue ?? k0.enterpriseValueTTM);
      const ebit = num(k0.ebitTTM ?? k0.operatingIncomeTTM);
      if (ev !== null && ebit !== null && ebit !== 0) {
        evEbit = String(ev / ebit);
      }
    }
    const partial =
      !evEbit || !pe ? "partial" : ("fmp" as const);
    return {
      pe: pe ?? "",
      ev_ebit: evEbit ?? "",
      roic: roic ?? "",
      net_debt_ebitda: netDebtEbitda ?? "",
      metrics_source: partial,
    };
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numStr(v: unknown): string | undefined {
  const n = num(v);
  return n === null ? undefined : String(n);
}

export async function fetchMetricsYfinance(ticker: string): Promise<MetricSnapshot> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ticker], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (c) => {
      out += String(c);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(emptyMetrics("partial"));
        return;
      }
      try {
        const parsed = JSON.parse(out) as MetricSnapshot;
        resolve({
          pe: parsed.pe ?? "",
          ev_ebit: parsed.ev_ebit ?? "",
          roic: parsed.roic ?? "",
          net_debt_ebitda: parsed.net_debt_ebitda ?? "",
          metrics_source: parsed.metrics_source || "yfinance",
        });
      } catch {
        resolve(emptyMetrics("partial"));
      }
    });
    proc.on("error", () => resolve(emptyMetrics("partial")));
  });
}

function emptyMetrics(source: MetricSnapshot["metrics_source"]): MetricSnapshot {
  return {
    pe: "",
    ev_ebit: "",
    roic: "",
    net_debt_ebitda: "",
    metrics_source: source,
  };
}

export function isInternationalTicker(ticker: string): boolean {
  return ticker.includes(".") && !ticker.endsWith(".US");
}

export async function enrichTickerMetrics(
  ticker: string,
  fmpKey: string | undefined,
): Promise<MetricSnapshot> {
  const intl = isInternationalTicker(ticker);
  if (!intl && fmpKey) {
    const fmp = await fetchMetricsFmp(ticker, fmpKey);
    if (fmp && fmp.metrics_source !== "partial") return fmp;
    if (fmp) {
      const yf = await fetchMetricsYfinance(ticker);
      return mergeMetrics(fmp, yf);
    }
  }
  if (fmpKey && !intl) {
    const fmp = await fetchMetricsFmp(ticker, fmpKey);
    if (fmp) {
      const yf = await fetchMetricsYfinance(ticker);
      return mergeMetrics(fmp, yf);
    }
  }
  return fetchMetricsYfinance(ticker);
}

function mergeMetrics(a: MetricSnapshot, b: MetricSnapshot): MetricSnapshot {
  const source =
    a.metrics_source === "fmp" && b.metrics_source === "yfinance"
      ? "partial"
      : (b.metrics_source || a.metrics_source || "partial");
  return {
    pe: a.pe || b.pe,
    ev_ebit: a.ev_ebit || b.ev_ebit,
    roic: a.roic || b.roic,
    net_debt_ebitda: a.net_debt_ebitda || b.net_debt_ebitda,
    metrics_source: source,
  };
}
