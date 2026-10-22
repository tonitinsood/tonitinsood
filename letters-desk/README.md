# Letters desk

Static GitHub Pages table of **public** hedge-fund / investor letters. Not a Google Sheet. Not DigitalOcean. Does not scrape BuySideDigest.

## Cadence

GitHub Actions [`.github/workflows/letters-desk.yml`](../.github/workflows/letters-desk.yml):

- Cron `0 4 1 */2 *` UTC = **08:00 Asia/Dubai on the 1st of every other month**
- Plus **Actions → Letters desk → Run workflow**

The older **Daily idea screen** workflow is unchanged.

## Run locally

```bash
cd idea-screener
npm install
pip install -r requirements.txt
npx tsx ../letters-desk/src/run.ts --no-discover
```

Writes `site/` (HTML + `letters.json` + `site/pdfs/`). Optional `FMP_API_KEY` fills P/E, EV/EBIT, ROIC, net debt/EBITDA on resolved tickers. Optional `CURSOR_API_KEY` / `OPENAI_API_KEY` / `LLM_BASE_URL` for LLM metadata; otherwise heuristic extract.

## Add a fund

Edit [`config/funds.json`](../config/funds.json): name, manager, region, and a public `pdf_url` (or `index_url` to discover new PDFs). Official IR only.

## GitHub Pages

Settings → Pages → Build and deployment → Source: **GitHub Actions**. After the workflow has run, the site is `https://tonitinsood.github.io/` (this is the `username/username` repo). If GitHub instead treats it as a project site, use `https://tonitinsood.github.io/tonitinsood/`.
