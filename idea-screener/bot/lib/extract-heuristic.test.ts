import assert from "node:assert/strict";
import test from "node:test";
import { findTickers, isJunkTicker } from "./extract-heuristic.js";

test("junk PDF tokens are not tickers", () => {
  const blob = "%PDF-1.6 86 0 obj /Type /Catalog endobj startxref %%EOF ID GB US";
  assert.deepEqual(findTickers(blob), []);
  assert.equal(isJunkTicker("PDF"), true);
  assert.equal(isJunkTicker("GTM"), true);
  assert.equal(isJunkTicker("AAPL"), false);
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
