import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSite } from "./build-site.js";
import { ingestAll, loadFunds } from "./ingest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

const CADENCE =
  "Bi-monthly: 1st of every other month, 08:00 Asia/Dubai (cron 0 4 1 */2 * UTC), plus Run workflow";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const configPath = path.join(REPO_ROOT, "config/funds.json");
  const siteDir = path.join(REPO_ROOT, "site");
  const pdfDir = path.join(siteDir, "pdfs");
  const staticDir = path.join(HERE, "../static");
  const discover = !args.has("--no-discover");
  const fmpKey = process.env.FMP_API_KEY?.trim();

  const fundsFile = loadFunds(configPath);
  const { letters, failures } = await ingestAll({
    fundsFile,
    pdfDir,
    fmpKey,
    discover,
  });
  if (letters.length === 0) {
    throw new Error(
      `No letters ingested. Failures: ${failures.map((f) => f.id).join(", ") || "none"}`,
    );
  }
  writeSite({ siteDir, staticDir, letters, cadence: CADENCE });
  const summary = {
    ok: true,
    letters: letters.length,
    funds: [...new Set(letters.map((l) => l.fund))],
    llm: letters.filter((l) => l.extract_method === "llm").length,
    heuristic: letters.filter((l) => l.extract_method === "heuristic").length,
    failures,
  };
  fs.writeFileSync(path.join(siteDir, "build-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
