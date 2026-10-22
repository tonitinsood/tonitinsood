# tonitinsood

Personal monorepo.

## Letters desk (primary)

Public hedge-fund letters table on **GitHub Pages** — date, fund, manager, tickers, themes, quick take, long/short pitches, geo, View PDF, Analysis.

- Config: [`config/funds.json`](config/funds.json)
- Builder: [`letters-desk/`](letters-desk/)
- Workflow: [`.github/workflows/letters-desk.yml`](.github/workflows/letters-desk.yml) — **bi-monthly** cron `0 4 1 */2 *` UTC (08:00 Asia/Dubai on the 1st of every other month) plus **Run workflow**
- Site output: `site/` (published by GitHub Actions)

See [`letters-desk/README.md`](letters-desk/README.md).

## Stock Idea Screener (daily Sheet, unchanged)

BDK agent in [`idea-screener/`](idea-screener/) — daily pitch ingestion to Google Sheets. Workflow [`.github/workflows/idea-screener-daily.yml`](.github/workflows/idea-screener-daily.yml) is still scheduled. One-time Google Sheets + FMP setup: Idea Screener project store **`docs/setup-google-sheets-fmp.md`**.
