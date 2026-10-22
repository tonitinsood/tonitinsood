import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalPdfUrl,
  dedupeLetters,
  dedupeSeedLetters,
  isKnownPdf,
  knownPdfKeys,
  letterIdentityKey,
} from "./dedupe.js";
import type { FundConfig, LetterRecord, SeedLetter } from "./types.js";

function letter(partial: Partial<LetterRecord> & Pick<LetterRecord, "id" | "title" | "pdf_url">): LetterRecord {
  return {
    date: "2025-03-01",
    quarter: "Q1 2025",
    fund_id: "fairfax",
    fund: "Fairfax Financial",
    manager: "Prem Watsa",
    region: "Canada",
    geo: "Canada",
    cap: "",
    tickers: [],
    themes: [],
    pitches: [],
    pdf_local: `pdfs/${partial.id}.pdf`,
    source_url: partial.pdf_url,
    extract_method: "heuristic",
    ...partial,
  };
}

test("canonicalPdfUrl strips www, query, hash, trailing slash", () => {
  assert.equal(
    canonicalPdfUrl("https://www.Fairfax.ca/wp/letter.pdf?utm=1#p"),
    "https://fairfax.ca/wp/letter.pdf",
  );
  assert.equal(
    canonicalPdfUrl("https://fairfax.ca/wp/letter.pdf/"),
    canonicalPdfUrl("https://www.fairfax.ca/wp/letter.pdf?x=1"),
  );
});

test("dedupeLetters collapses the same PDF listed twice", () => {
  const a = letter({
    id: "fairfax-2024-chairman",
    title: "Chairman's Letter to Shareholders 2024",
    pdf_url: "https://www.fairfax.ca/wp/letter-2024.pdf",
  });
  const b = letter({
    id: "fairfax-undated-letter-2024",
    title: "Fairfax Financial letter",
    pdf_url: "https://fairfax.ca/wp/letter-2024.pdf?download=1",
  });
  const out = dedupeLetters([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, "fairfax-2024-chairman");
});

test("dedupeLetters collapses the same fund+date+title with different URLs", () => {
  const a = letter({
    id: "seed",
    title: "Annual Letter to Shareholders 2025",
    date: "2026-01-01",
    pdf_url: "https://fundsmith.co.uk/media/a.pdf",
  });
  const b = letter({
    id: "clone",
    title: "Annual Letter to Shareholders 2025",
    date: "2026-01-01",
    pdf_url: "https://cdn.fundsmith.co.uk/a-copy.pdf",
  });
  const out = dedupeLetters([a, b]);
  assert.equal(out.length, 1);
});

test("distinct PDFs with generic titles are not merged", () => {
  const a = letter({
    id: "a",
    title: "Fairfax Financial letter",
    date: "2026-10-22",
    pdf_url: "https://fairfax.ca/wp/2021.pdf",
  });
  const b = letter({
    id: "b",
    title: "Fairfax Financial letter",
    date: "2026-10-22",
    pdf_url: "https://fairfax.ca/wp/2022.pdf",
  });
  assert.equal(dedupeLetters([a, b]).length, 2);
});

test("dedupeSeedLetters drops a repeated PDF URL", () => {
  const seeds: SeedLetter[] = [
    {
      id: "one",
      title: "Letter 2024",
      date: "2025-03-01",
      pdf_url: "https://www.example.com/a.pdf",
    },
    {
      id: "two",
      title: "Letter 2024 copy",
      date: "2025-03-01",
      pdf_url: "https://example.com/a.pdf?utm=1",
    },
  ];
  assert.equal(dedupeSeedLetters(seeds).length, 1);
});

test("knownPdfKeys matches filename even when the host differs", () => {
  const fund: FundConfig = {
    id: "fairfax",
    name: "Fairfax Financial",
    manager: "Prem Watsa",
    region: "Canada",
    letters: [
      {
        id: "fairfax-2025",
        title: "Chairman's Letter 2025",
        date: "2026-03-01",
        pdf_url: "https://www.fairfax.ca/wp/FFH_Shareholders-Letter-2025.pdf",
      },
    ],
  };
  const known = knownPdfKeys(fund);
  assert.equal(
    isKnownPdf("https://cdn.fairfax.ca/other/FFH_Shareholders-Letter-2025.pdf", known),
    true,
  );
  assert.equal(isKnownPdf("https://fairfax.ca/wp/FFH_Shareholders-Letter-2024.pdf", known), false);
});

test("letterIdentityKey is stable across punctuation", () => {
  assert.equal(
    letterIdentityKey({ fund_id: "oaktree", date: "2025-12-09", title: "Is It a Bubble?" }),
    letterIdentityKey({ fund_id: "oaktree", date: "2025-12-09", title: "Is it a bubble" }),
  );
});
