import assert from "node:assert/strict";
import test from "node:test";
import {
  extractQuickTake,
  extractThemes,
  heuristicLetter,
  parseLetterDate,
  quarterFromDate,
} from "./extract-letter.js";
import type { FundConfig } from "./types.js";

const fund: FundConfig = {
  id: "demo",
  name: "Demo Fund",
  manager: "Ada Manager",
  region: "UK",
  letters: [],
};

test("parses month-year and quarter dates", () => {
  assert.equal(parseLetterDate("January 2026\nDear Fellow Investor", "1999-01-01"), "2026-01-01");
  assert.equal(parseLetterDate("April 9, 2025 memo", ""), "2025-04-09");
  assert.equal(parseLetterDate("4Q 2025 quarterly letter", ""), "2025-12-31");
  assert.equal(quarterFromDate("2026-01-01"), "Q1 2026");
});

test("quick take is a few sentences, never the whole letter", () => {
  const paras = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i + 1} about the portfolio and why the business is cheap relative to intrinsic value.`).join(" ");
  const letter = `Demo Fund\nJanuary 2026\nDear Fellow Investor,\nThe table below shows performance.\n${paras}`;
  const take = extractQuickTake(letter);
  assert.ok(take.length >= 80);
  assert.ok(take.length < 900);
  assert.equal(take.includes("%PDF"), false);
});

test("heuristic letter never dumps the full PDF as the only pitch", () => {
  const body = `January 2026
Dear Fellow Investor,
We are long LVMH (MC.PA) because the brand compounder is undervalued with a wide moat and high returns on capital.
The investment thesis is a margin of safety on free cash flow.
${"More commentary. ".repeat(800)}`;
  const letter = heuristicLetter(body, fund, {
    id: "demo-2026",
    title: "Annual letter",
    date: "2026-01-01",
    pdf_url: "https://example.com/letter.pdf",
  });
  assert.equal(letter.fund, "Demo Fund");
  assert.ok(letter.quick_take.length < body.length / 4);
  for (const pitch of letter.pitches) {
    assert.ok(pitch.writeup.length < 4000);
    assert.equal(pitch.writeup.includes("%PDF"), false);
  }
  assert.ok(extractThemes(body).includes("value"));
});

test("raw PDF bytes are not treated as a quick take", () => {
  const take = extractQuickTake("%PDF-1.7\n1 0 obj<<>>stream binary");
  assert.ok(!take.startsWith("%PDF"));
});

test("seed date wins over historical dates in the memo body", () => {
  const letter = heuristicLetter(
    "On Monday, September 15, 2008, Lehman filed.\nApril 9, 2025\nWe discuss cycles and valuation.",
    fund,
    {
      id: "demo-seed-date",
      title: "Nobody Knows",
      date: "2025-04-09",
      pdf_url: "https://example.com/memo.pdf",
    },
  );
  assert.equal(letter.date, "2025-04-09");
  assert.equal(letter.quarter, "Q2 2025");
});
