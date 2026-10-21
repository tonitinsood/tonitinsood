import { defineEval, matches } from "@cursor/bdk/evals";
import * as z from "zod/v4";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "validate-extraction-fixture",
      description: "Deterministic validateExtractionFixture tool passes smoke JSON.",
      async test(t) {
        await t.send(
          [
            "Eval smoke: call validateExtractionFixture once with input {}.",
            "Do not call any other tools. Reply with a single word: done.",
          ].join(" "),
        );
        t.succeeded();
        const call = t.requireToolCall("validateExtractionFixture", {
          status: "completed",
        });
        t.check(
          call.output,
          matches(
            z.object({
              ok: z.literal(true),
              pitchCount: z.number().min(1),
            }),
          ),
        );
      },
    },
  ],
});
