import assert from "node:assert/strict";
import test from "node:test";
import { findTickers, isJunkTicker } from "./extract-heuristic.js";
import { canonicalSourceUrl, dedupeKey } from "./kv.js";

test("junk PDF tokens are not tickers", () => {
  const blob = "%PDF-1.6 86 0 obj /Type /Catalog endobj startxref %%EOF ID GB US";
  assert.deepEqual(findTickers(blob), []);
  assert.equal(isJunkTicker("PDF"), true);
  assert.equal(isJunkTicker("GTM"), true);
  assert.equal(isJunkTicker("AAPL"), false);
});

test("canonicalSourceUrl treats www and trailing slash as the same page", () => {
  const a = canonicalSourceUrl(
    "https://www.semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter/",
  );
  const b = canonicalSourceUrl(
    "https://semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter",
  );
  assert.equal(a, b);
  assert.equal(dedupeKey(a, "AMD"), dedupeKey(b, "amd"));
});

test("real tickers are kept; two-letter junk is not", () => {
  const blob = "We added to $AAPL and NYSE BAC while trimming KO versus US GDP.";
  const found = findTickers(blob);
  assert.ok(found.includes("AAPL"));
  assert.ok(found.includes("BAC"));
  assert.ok(found.includes("KO"));
  assert.ok(!found.includes("US"));
  assert.ok(!found.includes("GDP"));
});
