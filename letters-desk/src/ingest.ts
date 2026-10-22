import fs from "node:fs";
import path from "node:path";
import { fetchBytes } from "../../idea-screener/bot/lib/ingest/fetch.js";
import { extractPdfText, isPdfMagic } from "../../idea-screener/bot/lib/ingest/pdf.js";
import { looksUnreadable, sanitizeText } from "../../idea-screener/bot/lib/ingest/readable.js";
import { enrichTickerMetrics } from "../../idea-screener/bot/lib/metrics.js";
import { discoverNewPdfs, slugId } from "./discover.js";
import {
  heuristicLetter,
  mergeLlmIntoHeuristic,
  parseLetterDate,
} from "./extract-letter.js";
import { llmExtractLetter } from "./llm.js";
import type { FundConfig, FundsFile, LetterRecord, SeedLetter } from "./types.js";

const MAX_PDF_BYTES = 12_000_000;

export function loadFunds(configPath: string): FundsFile {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as FundsFile;
  if (!Array.isArray(parsed.funds) || parsed.funds.length === 0) {
    throw new Error(`No funds in ${configPath}`);
  }
  return parsed;
}

export async function fetchPdf(url: string): Promise<Buffer> {
  const fetched = await fetchBytes(url, MAX_PDF_BYTES);
  if (!isPdfMagic(fetched.bytes) && !/application\/pdf/i.test(fetched.contentType)) {
    throw new Error(`Not a PDF: ${url} (${fetched.contentType || "unknown type"})`);
  }
  return fetched.bytes;
}

async function enrichPitches(letter: LetterRecord, fmpKey: string | undefined): Promise<void> {
  const seen = new Set<string>();
  for (const pitch of letter.pitches) {
    const ticker = pitch.ticker.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    try {
      const metrics = await enrichTickerMetrics(ticker, fmpKey);
      pitch.pe = metrics.pe;
      pitch.ev_ebit = metrics.ev_ebit;
      pitch.roic = metrics.roic;
      pitch.net_debt_ebitda = metrics.net_debt_ebitda;
      pitch.metrics_source = metrics.metrics_source;
      for (const other of letter.pitches) {
        if (other.ticker.toUpperCase() === ticker && other !== pitch) {
          other.pe = pitch.pe;
          other.ev_ebit = pitch.ev_ebit;
          other.roic = pitch.roic;
          other.net_debt_ebitda = pitch.net_debt_ebitda;
          other.metrics_source = pitch.metrics_source;
        }
      }
    } catch {
      /* metrics are optional */
    }
    if (seen.size >= 12) break;
  }
}

export async function ingestOne(
  fund: FundConfig,
  seed: SeedLetter,
  pdfDir: string,
  fmpKey: string | undefined,
): Promise<LetterRecord> {
  const bytes = await fetchPdf(seed.pdf_url);
  const text = sanitizeText(await extractPdfText(bytes));
  if (!text || looksUnreadable(text) || text.length < 80) {
    throw new Error(`Unreadable PDF text for ${seed.id} (${seed.pdf_url})`);
  }
  fs.mkdirSync(pdfDir, { recursive: true });
  const localName = `${seed.id}.pdf`;
  fs.writeFileSync(path.join(pdfDir, localName), bytes);

  const base = heuristicLetter(text, fund, seed);
  const llm = await llmExtractLetter(
    text,
    fund.name,
    seed.manager || fund.manager,
    seed.title,
    seed.pdf_url,
  );
  const letter = mergeLlmIntoHeuristic(base, llm);
  letter.pdf_local = `pdfs/${localName}`;
  await enrichPitches(letter, fmpKey);
  return letter;
}

export async function ingestAll(opts: {
  fundsFile: FundsFile;
  pdfDir: string;
  fmpKey: string | undefined;
  discover: boolean;
}): Promise<{ letters: LetterRecord[]; failures: { id: string; error: string }[] }> {
  const letters: LetterRecord[] = [];
  const failures: { id: string; error: string }[] = [];
  const blocked = opts.fundsFile.blocked_hosts ?? [];

  for (const fund of opts.fundsFile.funds) {
    const known = new Set(
      fund.letters.map((l) => l.pdf_url.split("?")[0]!.toLowerCase()),
    );
    const extras: SeedLetter[] = [];
    if (opts.discover) {
      const found = await discoverNewPdfs(fund, known, blocked);
      for (const url of found) {
        const guessDate = parseLetterDate(url, "");
        extras.push({
          id: slugId(fund.id, url, guessDate || "new"),
          title: `${fund.name} letter`,
          date: guessDate || new Date().toISOString().slice(0, 10),
          pdf_url: url,
        });
      }
    }

    for (const seed of [...fund.letters, ...extras]) {
      try {
        const letter = await ingestOne(fund, seed, opts.pdfDir, opts.fmpKey);
        letters.push(letter);
        console.log(
          `ok ${letter.id} method=${letter.extract_method} tickers=${letter.tickers.length} pitches=${letter.pitches.length}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: seed.id, error: message });
        console.warn(`skip ${seed.id}: ${message}`);
      }
    }
  }

  letters.sort((a, b) => b.date.localeCompare(a.date) || a.fund.localeCompare(b.fund));
  return { letters, failures };
}
