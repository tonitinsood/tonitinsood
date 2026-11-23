import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { runDailyScreenPipeline } from "../lib/pipeline.js";

export default defineTool({
  description:
    "Run the daily ingest pipeline: fetch pitch feeds, keep only named stock pitches (ticker/company + thesis), prefer non-US, rewrite unreadable cells, apply shortlisted/archived checkboxes, dedupe, enrich metrics (FMP then yfinance), append complete pitch text (FullText parts if needed), clear non-pitch rows unless shortlisted/archived, purge rows older than 7 days unless shortlisted/archived.",
  effect: "write",
  inputSchema: z.object({
    dryRun: z
      .boolean()
      .optional()
      .describe("If true, ingest and extract but do not write Google Sheet or KV dedupe."),
    exhaustive: z
      .boolean()
      .optional()
      .describe(
        "Raise ingest caps (~4×) for letters, Substack, SEC, X, and US pitch cap. Also honors SCREENER_EXHAUSTIVE=1.",
      ),
  }),
  async execute({ dryRun, exhaustive }, ctx) {
    const result = await runDailyScreenPipeline(ctx, {
      dryRun: dryRun ?? false,
      exhaustive: exhaustive ?? false,
    });
    return result;
  },
});
