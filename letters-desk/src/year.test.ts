import assert from "node:assert/strict";
import test from "node:test";
import { isCalendar2026Letter, isRejectedPre2026 } from "./year.js";

test("keeps 2026 semi-annual and quarterlies", () => {
  assert.equal(
    isCalendar2026Letter({
      title: "Semi Annual Letter to Shareholders 2026",
      date: "2026-06-30",
      pdf_url: "https://www.fundsmith.co.uk/media/x/2026-fef-semi-annual-letter-to-shareholders-web.pdf",
    }),
    true,
  );
  assert.equal(
    isCalendar2026Letter({
      title: "A Catalyst for the AI Bubble Break (3Q 2026)",
      date: "2026-09-30",
      pdf_url: "https://www.gmo.com/globalassets/articles/quarterly-letter/2026/gmo-quarterly-letter_3q-2026.pdf",
    }),
    true,
  );
});

test("drops 2025 annuals even when posted in 2026", () => {
  assert.equal(
    isRejectedPre2026({
      id: "fundsmith-equity-2025-annual",
      title: "Annual Letter to Shareholders 2025",
      date: "2026-01-01",
      pdf_url: "https://www.fundsmith.co.uk/media/4hcfd1pg/2025-fef-annual-letter-web.pdf",
    }),
    true,
  );
  assert.equal(
    isRejectedPre2026({
      title: "Chairman's Letter to Shareholders 2025",
      date: "2026-03-01",
    }),
    true,
  );
});

test("drops 2025 quarterlies and 2024 insights", () => {
  assert.equal(
    isRejectedPre2026({
      title: "It's Probably a Bubble (4Q 2025)",
      date: "2025-12-31",
    }),
    true,
  );
  assert.equal(
    isRejectedPre2026({
      title: "A Very Long Hill",
      date: "2024-04-29",
    }),
    true,
  );
});

test("keeps a 2026 memo whose title has no year", () => {
  assert.equal(
    isRejectedPre2026({
      title: "Shall We Repeal the Laws of Economics – Part III",
      date: "2026-09-22",
      pdf_url: "https://www.oaktreecapital.com/docs/default-source/memos/shall-we-repeal-the-laws-of-economics-part-iii.pdf",
    }),
    false,
  );
  assert.equal(
    isCalendar2026Letter({
      title: "Shall We Repeal the Laws of Economics – Part III",
      date: "2026-09-22",
    }),
    true,
  );
});
