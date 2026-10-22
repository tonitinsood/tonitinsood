import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { FundsFile } from "./types.js";
import { isCalendar2026Letter } from "./year.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(HERE, "../../config/funds.json");

function load(): FundsFile {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as FundsFile;
}

test("funds.json has unique fund ids and one Oaktree / Alger / Longriver", () => {
  const { funds } = load();
  const ids = funds.map((f) => f.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.filter((id) => id === "oaktree").length, 1);
  assert.equal(ids.filter((id) => id === "alger-spectra").length, 1);
  assert.equal(ids.filter((id) => id === "longriver-partners").length, 1);
  assert.equal(funds.find((f) => f.id === "oaktree")?.priority, true);
  assert.equal(funds.find((f) => f.id === "alger-spectra")?.priority, true);
  assert.equal(funds.find((f) => f.id === "longriver-partners")?.priority, false);
});

test("no BuySideDigest or google.com/search letter URLs", () => {
  const { funds, blocked_hosts } = load();
  assert.ok((blocked_hosts ?? []).some((h) => h.includes("buysidedigest.com")));
  for (const fund of funds) {
    const urls = [fund.letter_url, fund.index_url, ...(fund.letters ?? []).map((l) => l.pdf_url)];
    for (const url of urls) {
      if (!url) continue;
      assert.equal(url.includes("buysidedigest.com"), false, url);
      assert.equal(url.includes("bsdpdfapi-production"), false, url);
      assert.equal(url.includes("google.com/search"), false, url);
    }
  }
});

test("seeded letters are 2026-only with unique ids and urls", () => {
  const { funds } = load();
  const letterIds: string[] = [];
  const urls: string[] = [];
  for (const fund of funds) {
    for (const letter of fund.letters ?? []) {
      assert.equal(
        isCalendar2026Letter(letter),
        true,
        `${letter.id} is not a 2026 letter`,
      );
      letterIds.push(letter.id);
      urls.push(letter.pdf_url);
      assert.ok(letter.pdf_url, `${letter.id} missing pdf_url`);
    }
  }
  assert.equal(letterIds.length, new Set(letterIds).size);
  assert.equal(urls.length, new Set(urls).size);
  assert.ok(letterIds.length > 0);
});

test("status funds have empty letter_url and no seeds", () => {
  const { funds } = load();
  const withStatus = funds.filter((f) => f.status);
  assert.ok(withStatus.length > 0);
  for (const fund of withStatus) {
    assert.ok(
      fund.status === "no_public_pdf" || fund.status === "no_2026_letter",
      `${fund.id} has unexpected status ${fund.status}`,
    );
    assert.equal(fund.letter_url, "");
    assert.deepEqual(fund.letters ?? [], []);
  }
});
