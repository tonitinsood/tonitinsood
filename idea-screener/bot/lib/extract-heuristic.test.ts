import assert from "node:assert/strict";
import test from "node:test";
import {
  companyFromTitle,
  extractPitchesHeuristic,
  findTickers,
  hasThesisLanguage,
  isConcretePitch,
  isJunkTicker,
  looksLikeGeneralLetter,
} from "./extract-heuristic.js";
import { canonicalSourceUrl, dedupeKey, sourceUrlSlug } from "./kv.js";
import { isNonUsListing, rankAndCapPitches } from "./markets.js";
import type { ExtractedPitch, IngestDocument } from "./types.js";

function doc(partial: Partial<IngestDocument> & Pick<IngestDocument, "title" | "body">): IngestDocument {
  return {
    source_type: "letter",
    source_name: "Test",
    pitched_by: "Author",
    source_url: "https://example.com/pitch",
    date: "2026-10-21",
    default_country: "",
    ...partial,
  };
}

test("junk PDF tokens are not tickers", () => {
  const blob = "%PDF-1.6 86 0 obj /Type /Catalog endobj startxref %%EOF ID GB US";
  assert.deepEqual(findTickers(blob), []);
  assert.equal(isJunkTicker("PDF"), true);
  assert.equal(isJunkTicker("GTM"), true);
  assert.equal(isJunkTicker("AAPL"), false);
});

test("bare words are not tickers; marked and suffixed names are", () => {
  const blob = "We added to $AAPL and NYSE:BAC while trimming KO versus US GDP. Toyota 7203.T is cheap.";
  const found = findTickers(blob);
  assert.ok(found.includes("AAPL"));
  assert.ok(found.includes("BAC"));
  assert.ok(found.includes("7203.T"));
  assert.ok(!found.includes("KO"));
  assert.ok(!found.includes("US"));
  assert.ok(!found.includes("GDP"));
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
  assert.equal(
    sourceUrlSlug(
      "https://newsletter.semianalysis.com/p/xais-colossus-2-first-gigawatt-datacenter",
    ),
    sourceUrlSlug(
      "https://semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter/",
    ),
  );
});

test("Berkshire-style shareholder letter with an obituary is not a pitch", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_name: "Berkshire Hathaway",
      title: "2023 Letter to Shareholders",
      body:
        "To the Shareholders of Berkshire Hathaway Inc.: Charlie Munger died on November 28, " +
        "just 33 days before his 100th birthday. Though born and raised in Omaha, he spent most of his life elsewhere. " +
        "We still own Apple and Coca-Cola. Our float grew and book value compounded.",
    }),
  );
  assert.deepEqual(pitches, []);
  assert.equal(looksLikeGeneralLetter("To the Shareholders of Berkshire Hathaway Inc."), true);
});

test("Japan activist write-up with a suffixed ticker becomes one pitch", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "substack",
      source_name: "8% Value Activist",
      default_country: "Japan",
      title: "Investment Idea #33 - Trend Micro, activist catalyzed take private",
      body:
        "Trend Micro (4704.T) remains undervalued after last year's activist-catalyzed take-private attempt. " +
        "The investment thesis is a buyback-funded rerating: free cash flow yield is high and a second bid is the catalyst. " +
        "We are long the shares versus the implied takeout.",
    }),
  );
  assert.equal(pitches.length, 1);
  assert.equal(pitches[0]?.ticker, "4704.T");
  assert.match(pitches[0]?.company ?? "", /Trend Micro/i);
  assert.equal(pitches[0]?.exchange_country, "Japan");
  assert.equal(pitches[0]?.ticker.includes("."), true);
  assert.ok(hasThesisLanguage(pitches[0]?.full_pitch ?? ""));
  assert.ok(isConcretePitch(pitches[0]!));
});

test("one letter that pitches two names splits into two rows", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "substack",
      source_name: "Value and Opportunity",
      default_country: "Europe",
      title: "Updates: CEWE and Rightmove",
      body:
        "CEWE Group ($CWC.DE) is still undervalued after the CMD. The investment thesis is a photobook cash cow with buybacks as the catalyst.\n\n" +
        "Rightmove ($RMV.L) looks overvalued versus Autotrader. We are short the UK portal on fee pressure and a bear case around AI listings.",
    }),
  );
  const tickers = pitches.map((p) => p.ticker).sort();
  assert.ok(tickers.includes("CWC.DE"));
  assert.ok(tickers.includes("RMV.L"));
  assert.ok(pitches.length >= 2);
  const cewe = pitches.find((p) => p.ticker === "CWC.DE");
  assert.match(cewe?.full_pitch ?? "", /photobook|CMD|buybacks/i);
  assert.doesNotMatch(cewe?.full_pitch ?? "", /fee pressure and a bear case around AI/);
});

test("13D Item 4 is a pitch even without $TICKER markup", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "sec_13d",
      source_name: "SEC EDGAR",
      title: "SC 13D - Howard Hughes Holdings Inc (HHH)",
      body:
        "CUSIP No. 44267T 10 1\nName of Issuer: Howard Hughes Holdings Inc.\nTrading Symbol: HHH\n" +
        "Item 4. Purpose of Transaction\nThe Reporting Persons acquired the shares because they believe the issuer is undervalued " +
        "and intend to seek board representation to unlock net asset value. Item 5. Interest in Securities",
    }),
  );
  assert.equal(pitches.length, 1);
  assert.equal(pitches[0]?.ticker, "HHH");
  assert.match(pitches[0]?.company ?? "", /Howard Hughes/i);
  assert.match(pitches[0]?.full_pitch ?? "", /Purpose of Transaction/i);
});

test("macro commentary without a named idea is skipped", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "substack",
      title: "Market commentary: GDP, the Fed, and inflation",
      body:
        "This week's market commentary covers GDP, the Fed, and inflation. " +
        "Equities rallied. We make no stock recommendation. Cash remains fine.",
    }),
  );
  assert.deepEqual(pitches, []);
});

test("non-US pitches are kept; US is capped", () => {
  const mk = (ticker: string, country: string): ExtractedPitch => ({
    date: "2026-10-21",
    source_type: "substack",
    source_name: "Test",
    pitched_by: "A",
    ticker,
    exchange_country: country,
    company: ticker,
    thesis_short: "undervalued",
    full_pitch: "undervalued",
    source_url: "https://example.com/" + ticker,
  });
  const input = [
    mk("7203.T", "Japan"),
    mk("RMV.L", "UK"),
    mk("AAPL", "US"),
    mk("MSFT", "US"),
    mk("NVDA", "US"),
    mk("AMZN", "US"),
    mk("META", "US"),
    mk("GOOG", "US"),
    mk("JPM", "US"),
    mk("XOM", "US"),
  ];
  const capped = rankAndCapPitches(input, 3);
  assert.equal(capped.filter((p) => p.exchange_country !== "US").length, 2);
  assert.equal(capped.filter((p) => p.exchange_country === "US").length, 3);
  assert.equal(isNonUsListing("7203.T", "Japan"), true);
  assert.equal(isNonUsListing("AAPL", "US"), false);
});

test("LSE: prefix maps to UK", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "substack",
      source_name: "Motley Fool UK",
      title: "Ocado shares heading to 460p",
      body:
        "Ocado (LSE:OCDO) shares just got a huge boost after JPMorgan raised its price target from 290p to 460p. " +
        "The investment thesis is a rerating on grocery automation.",
    }),
  );
  const ocdo = pitches.find((p) => p.ticker === "OCDO");
  assert.ok(ocdo);
  assert.equal(ocdo?.exchange_country, "UK");
});

test("unsuffixed $TICKER from a Japan feed is still US", () => {
  const pitches = extractPitchesHeuristic(
    doc({
      source_type: "substack",
      default_country: "Japan",
      title: "Activist Happenings: Align Technology",
      body:
        "Align Technology ($ALGN) was engaged by Elliott. The investment thesis is an activist-led buyback and margin recovery. We are long the shares.",
    }),
  );
  const algn = pitches.find((p) => p.ticker === "ALGN");
  assert.ok(algn);
  assert.equal(algn?.exchange_country, "US");
});

test("companyFromTitle picks the name from an idea headline", () => {
  assert.match(
    companyFromTitle("Investment Idea #33 - Trend Micro, Activist Catalyzed Take Private"),
    /Trend Micro/i,
  );
  assert.match(companyFromTitle("Integer Holdings ($ITGR): Deep Dive"), /Integer Holdings/i);
});
