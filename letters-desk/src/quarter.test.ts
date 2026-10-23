import assert from "node:assert/strict";
import test from "node:test";
import {
  letterQuarter,
  parseExplicitQuarter,
  quarterFromPublicationDate,
} from "./quarter.js";

test("publication lag: Oct letter is Q3 same year, not Q4", () => {
  assert.equal(quarterFromPublicationDate("2026-10-15"), "Q3 2026");
  assert.equal(quarterFromPublicationDate("2026-01-01"), "Q4 2025");
  assert.equal(quarterFromPublicationDate("2026-04-09"), "Q1 2026");
  assert.equal(quarterFromPublicationDate("2026-07-01"), "Q2 2026");
});

test("explicit quarter in title or URL wins over publication date", () => {
  assert.equal(
    letterQuarter({
      date: "2026-10-01",
      title: "Distillate Q3 2026 Letter",
      pdf_url: "",
    }),
    "Q3 2026",
  );
  assert.equal(
    parseExplicitQuarter("StrategyCommentary-ClearBridgeSmallCapGrowth3Q26-US-en-US.pdf"),
    "Q3 2026",
  );
  assert.equal(parseExplicitQuarter("Oakmark Select Fund Commentary 3Q 2026"), "Q3 2026");
  assert.equal(parseExplicitQuarter("3Q_2026_BVG.pdf"), "Q3 2026");
  assert.equal(
    letterQuarter({
      date: "2026-10-21",
      title: "3Q 2026: Buy and Hold Is Not a Strategy",
      text: "We discussed Q2 2025 results at length.",
    }),
    "Q3 2026",
  );
});

test("semi-annual letters label H1/H2 when explicit quarter absent", () => {
  assert.equal(
    letterQuarter({
      date: "2026-06-30",
      title: "Semi Annual Letter to Shareholders 2026",
    }),
    "H1 2026",
  );
});
