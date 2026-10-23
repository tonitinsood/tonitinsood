import fs from "node:fs";
import path from "node:path";
import { esc, fmtNum, paraHtml } from "./escape.js";
import type { LetterPitch, LetterRecord, SitePayload } from "./types.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

const TICKER_INLINE_MAX = 6;

function pills(items: string[], cls: string): string {
  if (!items.length) return '<span class="muted">—</span>';
  return `<div class="pills">${items.map((t) => `<span class="${cls}">${esc(t)}</span>`).join("")}</div>`;
}

function tickerPills(items: string[]): string {
  if (!items.length) return '<span class="muted">—</span>';
  const shown = items.slice(0, TICKER_INLINE_MAX);
  const rest = items.length - shown.length;
  const chips = shown.map((t) => `<span class="pill">${esc(t)}</span>`).join("");
  const more =
    rest > 0
      ? `<span class="pill pill-more" title="${esc(items.join(", "))}">+ ${rest} more</span>`
      : "";
  return `<div class="pills">${chips}${more}</div>`;
}

function stancePills(pitches: LetterPitch[]): string {
  if (!pitches.length) return '<span class="muted">—</span>';
  return pitches
    .slice(0, 6)
    .map((p) => {
      const label = p.ticker || p.company || p.stance;
      return `<span class="stance ${esc(p.stance)}">${esc(p.stance)} ${esc(label)}</span>`;
    })
    .join(" ");
}

function options(values: string[], emptyLabel: string): string {
  return [
    `<option value="">${esc(emptyLabel)}</option>`,
    ...values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`),
  ].join("");
}

function letterHref(id: string): string {
  return `letters/${encodeURIComponent(id)}.html`;
}

function pdfHref(letter: LetterRecord, fromLetterPage = false): string {
  if (letter.pdf_local) {
    return fromLetterPage ? `../${letter.pdf_local}` : letter.pdf_local;
  }
  return letter.pdf_url;
}

export function pitchFlagId(letterId: string, pitch: LetterPitch, index: number): string {
  const slug = (pitch.ticker || pitch.company || `p${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${letterId}::pitch::${slug || index}`;
}

function flagCheckbox(id: string, flag: "shortlist" | "archive", label: string): string {
  return `<label class="flag">
    <input type="checkbox" data-flag="${flag}" data-id="${esc(id)}" aria-label="${esc(label)}">
  </label>`;
}

function shell(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="styles.css">
  ${extraHead}
</head>
<body>
${body}
</body>
</html>
`;
}

function topNav(isLetter: boolean): string {
  const prefix = isLetter ? "../" : "";
  return `<header class="top">
  <div class="top-inner">
    <p class="brand">Letters desk</p>
    <h1>Public fund letters</h1>
    <p class="lede">Date, fund, manager, tickers, themes, and long/short pitches — with the real PDF. Shortlist and Archive ticks stay in this browser. Checked bi-monthly. Not a 9,000-letter archive and not affiliated with any paid letters product.</p>
    <nav class="nav">
      <a href="${prefix}index.html">Letters</a>
      <a href="${prefix}index.html#about">About</a>
    </nav>
  </div>
</header>`;
}

function indexHtml(payload: SitePayload): string {
  const letters = payload.letters;
  const funds = uniqueSorted(letters.map((l) => l.fund));
  const tickers = uniqueSorted(letters.flatMap((l) => l.tickers));
  const themes = uniqueSorted(letters.flatMap((l) => l.themes));
  const geos = uniqueSorted(letters.map((l) => l.region).concat(letters.flatMap((l) => l.geo.split(",").map((g) => g.trim()))));
  const rows = letters
    .map((l) => {
      const search = [l.fund, l.manager, l.title, l.tickers.join(" "), l.themes.join(" "), l.geo].join(" ");
      const letterRow = `<tr class="letter-row" data-letter="${esc(l.id)}" data-fund="${esc(l.fund)}" data-tickers="${esc(l.tickers.join("|"))}" data-themes="${esc(l.themes.join("|"))}" data-geo="${esc(l.geo)} ${esc(l.region)}" data-search="${esc(search)}">
  <td class="tick">${flagCheckbox(l.id, "shortlist", `Shortlist ${l.title}`)}</td>
  <td class="tick">${flagCheckbox(l.id, "archive", `Archive ${l.title}`)}</td>
  <td>${esc(l.quarter || "—")}</td>
  <td>${esc(l.date)}</td>
  <td><div class="fund">${esc(l.fund)}</div><div>${esc(l.title)}</div></td>
  <td>${esc(l.manager)}</td>
  <td>${tickerPills(l.tickers)}</td>
  <td>${pills(l.themes, "theme")}</td>
  <td>${stancePills(l.pitches)}</td>
  <td>${esc(l.geo || l.region || "—")}</td>
  <td class="actions">
    <a href="${esc(pdfHref(l))}" target="_blank" rel="noopener">View PDF</a><br>
    <a href="${esc(letterHref(l.id))}">Analysis</a>
  </td>
</tr>`;
      const pitchRows = l.pitches
        .map((p, i) => {
          const pid = pitchFlagId(l.id, p, i);
          const label = [p.stance, p.ticker, p.company].filter(Boolean).join(" ");
          return `<tr class="pitch-row" data-letter="${esc(l.id)}" data-pitch="${esc(pid)}" data-fund="${esc(l.fund)}" data-tickers="${esc((p.ticker || "").toLowerCase())}" data-themes="${esc(l.themes.join("|"))}" data-geo="${esc(l.geo)} ${esc(l.region)}" data-search="${esc(search)} ${esc(label)}">
  <td class="tick">${flagCheckbox(pid, "shortlist", `Shortlist ${label}`)}</td>
  <td class="tick">${flagCheckbox(pid, "archive", `Archive ${label}`)}</td>
  <td colspan="2" class="pitch-kind">pitch</td>
  <td colspan="5"><span class="stance ${esc(p.stance)}">${esc(p.stance)}</span> ${esc(p.ticker || "—")} · ${esc(p.company || "unnamed")}</td>
  <td>${esc(p.country || l.geo || "—")}</td>
  <td class="actions"><a href="${esc(letterHref(l.id))}#${esc(pid)}">Analysis</a></td>
</tr>`;
        })
        .join("\n");
      return `${letterRow}\n${pitchRows}`;
    })
    .join("\n");

  const body = `${topNav(false)}
<form class="filters" id="filters">
  <input id="q" type="search" placeholder="Search fund, manager, ticker, theme">
  <select id="fund">${options(funds, "All funds")}</select>
  <select id="ticker">${options(tickers, "All tickers")}</select>
  <select id="theme">${options(themes, "All themes")}</select>
  <select id="geo">${options(geos, "All geos")}</select>
  <select id="flags">
    <option value="">All rows</option>
    <option value="shortlist">Shortlist</option>
    <option value="hide-archive">Hide archived</option>
    <option value="archive">Archived</option>
  </select>
</form>
<p class="meta-line"><span id="count">${letters.length}</span> letters · last built ${esc(payload.generated_at.slice(0, 16).replace("T", " "))} UTC · ${esc(payload.cadence)}</p>
<div class="table-wrap">
  <table class="letters">
    <thead>
      <tr>
        <th class="tick">Shortlist</th>
        <th class="tick">Archive</th>
        <th>Quarter</th>
        <th>Date</th>
        <th>Fund</th>
        <th>Manager</th>
        <th>Tickers</th>
        <th>Themes</th>
        <th>Pitches</th>
        <th>Geo</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td class="empty" colspan="11">No letters yet. Run the Letters desk workflow.</td></tr>`}
    </tbody>
  </table>
</div>
<footer id="about">
  <p>Library grows only from public PDFs listed in <code>config/funds.json</code>. Send a fund name and letter URL to add more. No DigitalOcean. Google Sheet remains a separate optional daily job. Shortlist and Archive are stored in this browser only (localStorage v1).</p>
</footer>
<script src="app.js"></script>`;
  return shell("Letters desk", body);
}

function metricsTable(p: LetterPitch): string {
  if (!p.ticker) return "";
  const source = p.metrics_source ? ` · ${esc(p.metrics_source)}` : "";
  return `<table class="metrics">
    <tr><th>Ticker</th><td>${esc(p.ticker)}${p.country ? ` · ${esc(p.country)}` : ""}</td></tr>
    <tr><th>P/E</th><td>${fmtNum(p.pe)}</td></tr>
    <tr><th>EV/EBIT</th><td>${fmtNum(p.ev_ebit)}</td></tr>
    <tr><th>ROIC</th><td>${fmtNum(p.roic)}</td></tr>
    <tr><th>Net debt/EBITDA</th><td>${fmtNum(p.net_debt_ebitda)}</td></tr>
  </table>
  <p class="subhead">Metrics${source}. Blank means the name was not resolved on FMP/yfinance.</p>`;
}

function letterHtml(letter: LetterRecord): string {
  const pitches = letter.pitches
    .map((p, i) => {
      const name = p.company || p.ticker || "Pitch";
      const pid = pitchFlagId(letter.id, p, i);
      return `<article class="pitch" id="${esc(pid)}">
        <header>
          <h3>${esc(name)}</h3>
          <span class="stance ${esc(p.stance)}">${esc(p.stance)}</span>
        </header>
        <div class="toggles pitch-flags">
          <label><input type="checkbox" data-flag="shortlist" data-id="${esc(pid)}"> Shortlist</label>
          <label><input type="checkbox" data-flag="archive" data-id="${esc(pid)}"> Archive</label>
        </div>
        ${metricsTable(p)}
        <div class="writeup">${paraHtml(p.writeup)}</div>
      </article>`;
    })
    .join("\n");

  const localPdf = `../${letter.pdf_local}`;
  const body = `<header class="top">
  <div class="top-inner">
    <p class="brand">Letters desk</p>
    <h1>${esc(letter.fund)}</h1>
    <nav class="nav">
      <a href="../index.html">Letters</a>
      <a href="${esc(pdfHref(letter, true))}" target="_blank" rel="noopener">View PDF</a>
    </nav>
  </div>
</header>
<main class="letter-page">
  <p class="kicker">${esc(letter.date)} · ${esc(letter.quarter)} · ${esc(letter.geo || letter.region)}</p>
  <h1>${esc(letter.title)}</h1>
  <p class="subhead">${esc(letter.manager)}${letter.cap ? ` · ${esc(letter.cap)}-cap` : ""} · extract: ${esc(letter.extract_method)}</p>
  <div class="toggles">
    <label><input type="checkbox" data-flag="shortlist" data-id="${esc(letter.id)}"> Shortlist</label>
    <label><input type="checkbox" data-flag="archive" data-id="${esc(letter.id)}"> Archive</label>
  </div>
  <section class="cards">
    <div class="card"><h2>Tickers</h2>${pills(letter.tickers, "pill")}</div>
    <div class="card"><h2>Themes</h2>${pills(letter.themes, "theme")}</div>
  </section>
  <h2>Pitches</h2>
  ${pitches || `<p class="subhead">No named long/short write-up extracted. That is intentional — the whole letter is not treated as a pitch. Read the PDF.</p>`}
  <h2>PDF</h2>
  <p class="subhead"><a href="${esc(localPdf)}">PDF on this site</a> · <a href="${esc(letter.pdf_url)}">Issuer original</a></p>
  <iframe class="pdf-frame" title="Letter PDF" src="${esc(localPdf)}"></iframe>
</main>
<script src="../app.js"></script>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(letter.title)} — ${esc(letter.fund)}</title>
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
${body}
</body>
</html>
`;
}

function publicLetter(letter: LetterRecord): LetterRecord {
  const copy = { ...letter };
  delete (copy as { quick_take?: string }).quick_take;
  return copy;
}

export function writeSite(opts: {
  siteDir: string;
  staticDir: string;
  letters: LetterRecord[];
  cadence: string;
}): SitePayload {
  const payload: SitePayload = {
    generated_at: new Date().toISOString(),
    cadence: opts.cadence,
    letters: opts.letters.map(publicLetter),
  };
  const lettersDir = path.join(opts.siteDir, "letters");
  fs.mkdirSync(lettersDir, { recursive: true });
  fs.mkdirSync(path.join(opts.siteDir, "pdfs"), { recursive: true });
  fs.copyFileSync(path.join(opts.staticDir, "styles.css"), path.join(opts.siteDir, "styles.css"));
  fs.copyFileSync(path.join(opts.staticDir, "app.js"), path.join(opts.siteDir, "app.js"));
  fs.writeFileSync(path.join(opts.siteDir, ".nojekyll"), "");
  fs.writeFileSync(path.join(opts.siteDir, "letters.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(opts.siteDir, "index.html"), indexHtml(payload));
  const keep = new Set(opts.letters.map((l) => `${l.id}.html`));
  for (const name of fs.readdirSync(lettersDir)) {
    if (name.endsWith(".html") && !keep.has(name)) {
      fs.unlinkSync(path.join(lettersDir, name));
    }
  }
  const pdfDir = path.join(opts.siteDir, "pdfs");
  const keepPdf = new Set(
    opts.letters.map((l) => path.basename(l.pdf_local || "")).filter(Boolean),
  );
  if (fs.existsSync(pdfDir)) {
    for (const name of fs.readdirSync(pdfDir)) {
      if (!keepPdf.has(name)) fs.unlinkSync(path.join(pdfDir, name));
    }
  }
  for (const letter of opts.letters) {
    fs.writeFileSync(
      path.join(opts.siteDir, "letters", `${letter.id}.html`),
      letterHtml(letter),
    );
  }
  return payload;
}
