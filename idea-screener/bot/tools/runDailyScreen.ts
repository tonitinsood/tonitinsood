import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { runDailyScreenPipeline } from "../lib/pipeline.js";

export default defineTool({
  description:
    "Run the daily ingest pipeline: fetch sources, extract pitches, dedupe, enrich metrics (FMP then yfinance), append to Google Sheet, purge rows older than 7 days unless shortlisted/archived.",
  effect: "write",
  inputSchema: z.object({
    dryRun: z
      .boolean()
      .optional()
      .describe("If true, ingest and extract but do not write Google Sheet or KV dedupe."),
  }),
  async execute({ dryRun }, ctx) {
    const result = await runDailyScreenPipeline(ctx, { dryRun: dryRun ?? false });
    return result;
  },
});
