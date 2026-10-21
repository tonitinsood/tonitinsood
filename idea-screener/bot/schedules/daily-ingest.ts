import { defineSchedule } from "@cursor/bdk/schedules";

/**
 * Intended local time: 08:00 Asia/Dubai (UTC+4, no DST).
 * BDK evaluates cron in UTC → 04:00 UTC = 08:00 Dubai.
 */
export default defineSchedule({
  cron: "0 4 * * *",
  async run({ callTool, waitUntil }) {
    waitUntil(
      callTool("runDailyScreen", {
        dryRun: false,
      }),
    );
  },
});
