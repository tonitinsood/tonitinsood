import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  extractionResultSchema,
  normalizeExtractionResult,
} from "../lib/extract-schema.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/fixtures/extraction-smoke.json",
);

export default defineTool({
  description:
    "Deterministic smoke check: validates the bundled extraction JSON fixture (includes pitched_by vs source_name).",
  effect: "read",
  inputSchema: z.object({
    fixture: z
      .enum(["smoke"])
      .optional()
      .describe("Which fixture to validate (default smoke)."),
  }),
  async execute() {
    const raw = await readFile(fixturePath, "utf8");
    const parsed = extractionResultSchema.parse(JSON.parse(raw));
    const pitches = normalizeExtractionResult(parsed);
    const first = pitches[0];
    if (!first) {
      return { ok: false, reason: "empty pitches" };
    }
    if (!first.source_name.trim()) {
      return { ok: false, reason: "missing source_name" };
    }
    if (!first.pitched_by.trim()) {
      return { ok: false, reason: "expected pitched_by in smoke fixture" };
    }
    return {
      ok: true,
      pitchCount: pitches.length,
      sample: {
        source_name: first.source_name,
        pitched_by: first.pitched_by,
        ticker: first.ticker,
      },
    };
  },
});
