import * as z from "zod/v4";
import type { ExtractedPitch, SourceType } from "./types.js";

const sourceTypeSchema = z.enum([
  "letter",
  "sec_13d",
  "sec_13g",
  "sec_8k",
  "substack",
  "x",
]);

/**
 * JSON schema for pitch extraction (one object or `{ "pitches": [...] }`).
 * `pitched_by` = the person advocating the idea; `source_name` = org/publication/fund.
 */
export const extractedPitchSchema = z.object({
  date: z.string().describe("Pitch/filing/post date (ISO 8601 date or datetime)"),
  source_type: sourceTypeSchema,
  source_name: z
    .string()
    .describe("Organization, publication, fund, or filer — not the individual"),
  pitched_by: z
    .string()
    .describe(
      "Person who pitched the stock: author, fund manager, letter signatory, X display name. Empty string only if truly unknown.",
    ),
  ticker: z.string().describe("Resolved trading symbol including exchange suffix when needed"),
  exchange_country: z.string().describe("Inferred region or country for the listing"),
  company: z.string().describe("Legal or common company name"),
  thesis_short: z.string().describe("1–3 sentence summary of the investment thesis"),
  full_pitch: z.string().describe("Verbatim or full narrative text of the pitch"),
  source_url: z.string().describe("Canonical URL for the source document or post"),
});

export const extractionResultSchema = z.union([
  extractedPitchSchema,
  z.object({ pitches: z.array(extractedPitchSchema).min(1) }),
]);

export type ExtractionResultInput = z.infer<typeof extractionResultSchema>;

export function normalizeExtractionResult(
  parsed: ExtractionResultInput,
): ExtractedPitch[] {
  if ("pitches" in parsed) {
    return parsed.pitches.map(normalizeOne);
  }
  return [normalizeOne(parsed)];
}

function normalizeOne(p: z.infer<typeof extractedPitchSchema>): ExtractedPitch {
  return {
    date: p.date.trim(),
    source_type: p.source_type as SourceType,
    source_name: p.source_name.trim(),
    pitched_by: p.pitched_by.trim(),
    ticker: p.ticker.trim().toUpperCase(),
    exchange_country: p.exchange_country.trim(),
    company: p.company.trim(),
    thesis_short: p.thesis_short.trim(),
    full_pitch: p.full_pitch.trim(),
    source_url: p.source_url.trim(),
  };
}

/** OpenAI-style JSON schema fragment for prompts / tool outputSchema. */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  required: [
    "date",
    "source_type",
    "source_name",
    "pitched_by",
    "ticker",
    "exchange_country",
    "company",
    "thesis_short",
    "full_pitch",
    "source_url",
  ],
  properties: {
    date: { type: "string" },
    source_type: {
      type: "string",
      enum: ["letter", "sec_13d", "sec_13g", "sec_8k", "substack", "x"],
    },
    source_name: { type: "string" },
    pitched_by: { type: "string" },
    ticker: { type: "string" },
    exchange_country: { type: "string" },
    company: { type: "string" },
    thesis_short: { type: "string" },
    full_pitch: { type: "string" },
    source_url: { type: "string" },
  },
  additionalProperties: false,
} as const;
