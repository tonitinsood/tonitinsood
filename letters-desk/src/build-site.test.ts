import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeSite } from "./build-site.js";
import type { LetterRecord } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const sample: LetterRecord = {
  id: "demo-2026",
  date: "2026-01-01",
  quarter: "Q1 2026",
  fund_id: "demo",
  fund: "Demo Fund",
  manager: "Ada",
  title: "Annual letter",
  region: "UK",
  geo: "UK",
  cap: "",
  tickers: ["MC.PA"],
  themes: ["value"],
  pitches: [
    {
      stance: "long",
      ticker: "MC.PA",
      company: "LVMH",
      country: "France",
      writeup: "Brand compounder with a margin of safety on free cash flow and a durable moat.",
      pe: "",
      ev_ebit: "",
      roic: "",
      net_debt_ebitda: "",
      metrics_source: "",
    },
  ],
  pdf_url: "https://example.com/letter.pdf",
  pdf_local: "pdfs/demo-2026.pdf",
  source_url: "https://example.com/letter.pdf",
  extract_method: "heuristic",
};

test("writeSite drops Quick take and adds independent Shortlist/Archive columns", () => {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), "letters-desk-"));
  const staticDir = path.resolve(HERE, "../static");
  writeSite({
    siteDir,
    staticDir,
    letters: [sample],
    cadence: "test",
  });
  const index = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  const page = fs.readFileSync(path.join(siteDir, "letters/demo-2026.html"), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(siteDir, "letters.json"), "utf8"));
  assert.equal(index.includes("Quick take"), false);
  assert.equal(index.includes("quick_take"), false);
  assert.equal(index.includes("Shortlist"), true);
  assert.equal(index.includes("Archive"), true);
  assert.equal(index.includes('data-flag="shortlist"'), true);
  assert.equal(index.includes('data-flag="archive"'), true);
  assert.equal(index.includes("pitch-row"), true);
  assert.equal(index.includes("a short take"), false);
  assert.equal(page.includes("Quick take"), false);
  assert.equal(page.includes('data-flag="shortlist"'), true);
  assert.equal(json.letters[0].quick_take, undefined);
  assert.equal(json.letters[0].tickers[0], "MC.PA");
  fs.rmSync(siteDir, { recursive: true, force: true });
});
