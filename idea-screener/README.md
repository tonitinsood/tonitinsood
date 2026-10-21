# idea-screener (BDK)

Daily **stock idea screener** agent: ingests investor letters, SEC 13D/13G/8-K, Substack RSS, and X (best-effort), writes pitches to a master Google Sheet, enriches **P/E, EV/EBIT, ROIC, Net debt/EBITDA** via FMP + yfinance, and supports deep-research chat on shortlisted rows.

## What it does

- **Schedule:** `bot/schedules/daily-ingest.ts` — 08:00 **Asia/Dubai** (cron `0 4 * * *` UTC) calls `runDailyScreen`.
- **Sheet:** Tab `Pitches` with columns including **`pitched_by`** (person) vs **`source_name`** (org/publication/fund).
- **Retention:** Deletes rows after 7 days only if both `shortlisted` and `archived` are false.
- **Playground:** Manual runs and `researchPitch` for deep dives.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `Google_Account_Json` | Yes (live Sheet writes) | Full service account JSON (Cursor env; preferred name) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alt | Same JSON **string** or **file path** |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alt | Path to service account key file |
| `FMP_API_KEY` | Recommended | US metrics primary (free tier) |
| `CURSOR_API_KEY` | For model turns / evals | Cursor agent credential |

No secrets belong in the repo.

Setup steps (FMP + Google): see the Idea Screener project store doc **`docs/setup-google-sheets-fmp.md`**.

## Local run

```bash
cd idea-screener
npm install
pip install -r requirements.txt   # yfinance + pypdf for scripts/metrics.py and scripts/pdf_text.py

npx --yes "@cursor/bdk@0.2.27" validate
npm run check

# Deterministic tool smoke (no model):
npx --yes "@cursor/bdk@0.2.27" call validateExtractionFixture --dir . --input '{}'

# Dev server + playground:
npx --yes "@cursor/bdk@0.2.27" serve --dir . --mode single --dev
# Manual schedule trigger (dev):
curl -X POST http://127.0.0.1:3000/idea-screener/v1/dev/schedules/daily-ingest

# Dry-run pipeline (needs network; Sheet optional):
npx --yes "@cursor/bdk@0.2.27" call runDailyScreen --dir . --input '{"dryRun":true}'
```

## Config

- `config/sources.json` — index of seed feeds
- `config/letters.json`, `config/substack.json`, `config/sec.json`, `config/x-watchlist.json`

## Evals

```bash
npx --yes "@cursor/bdk@0.2.27" eval --dir . --tag smoke
```
