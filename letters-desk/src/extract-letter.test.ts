import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTickers,
  extractLetterTitle,
  extractThemes,
  heuristicLetter,
  parseLetterDate,
  quarterFromDate,
} from "./extract-letter.js";
import { isDeniedTicker, isEquityTicker } from "./tickers.js";
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
  assert.equal("quick_take" in letter, false);
  for (const pitch of letter.pitches) {
    assert.ok(pitch.writeup.length < 4000);
    assert.equal(pitch.writeup.includes("%PDF"), false);
  }
  assert.ok(extractThemes(body).includes("value"));
  assert.ok(letter.tickers.includes("MC.PA"));
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

test("discovered letters with no seed date parse the date from the PDF text", () => {
  const letter = heuristicLetter(
    "Chairman's Letter to Shareholders\nMarch 2024\nTo our Shareholders, book value compounded.",
    fund,
    {
      id: "demo-discovered",
      title: "Demo Fund letter",
      date: "",
      pdf_url: "https://example.com/other.pdf",
    },
  );
  assert.equal(letter.date, "2024-03-01");
  assert.match(letter.title, /Chairman|Shareholders/i);
});

test("DOJ and other jargon are not tickers; $MSFT and NYSE:BAC are", () => {
  const text =
    "The DOJ and FTC opened a case. CEO of the ETF cited US GDP. See the FAQ PDF. " +
    "We added $MSFT and NYSE:BAC. Toyota 7203.T is cheap. C.V. filings mention Q1.";
  const tickers = collectTickers(text, []);
  assert.ok(tickers.includes("MSFT"));
  assert.ok(tickers.includes("BAC"));
  assert.ok(tickers.includes("7203.T"));
  for (const bad of ["DOJ", "FTC", "CEO", "ETF", "GDP", "FAQ", "PDF", "Q1", "C.V", "AI", "LLC", "INC"]) {
    assert.equal(tickers.includes(bad), false, bad);
    assert.equal(isDeniedTicker(bad) || !isEquityTicker(bad, { kind: "bare" }), true, bad);
  }
});

test("parenthetical 3-letter agencies drop; Holdings (JKH) can stay", () => {
  const junk = collectTickers("The Department of Justice (DOJ) and the Commission (FTC) investigated.", []);
  assert.deepEqual(junk, []);
  const keep = collectTickers("We added to John Keells Holdings (JKH) during the year.", []);
  assert.ok(keep.includes("JKH"));
});

test("extractLetterTitle skips a generic fund letter fallback", () => {
  const title = extractLetterTitle(
    "Is It a Bubble?\n\nOurs is a remarkable moment in world history.",
    "Oaktree Capital letter",
    "Oaktree Capital",
  );
  assert.equal(title, "Is It a Bubble?");
});
