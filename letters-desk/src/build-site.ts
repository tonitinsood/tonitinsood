import fs from "node:fs";
import path from "node:path";
import { esc, fmtNum, paraHtml } from "./escape.js";
import type { LetterPitch, LetterRecord, SitePayload } from "./types.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function pills(items: string[], cls: string): string {
  if (!items.length) return '<span class="muted">—</span>';
  return `<div class="pills">${items.map((t) => `<span class="${cls}">${esc(t)}</span>`).join("")}</div>`;
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
    <p class="lede">Date, fund, manager, tickers, themes, a short take, and long/short pitches — with the real PDF. Checked bi-monthly. Not a 9,000-letter archive and not affiliated with any paid letters product.</p>
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
      const search = [l.fund, l.manager, l.title, l.quick_take, l.tickers.join(" "), l.themes.join(" "), l.geo].join(" ");
      return `<tr data-letter="${esc(l.id)}" data-fund="${esc(l.fund)}" data-tickers="${esc(l.tickers.join("|"))}" data-themes="${esc(l.themes.join("|"))}" data-geo="${esc(l.geo)} ${esc(l.region)}" data-search="${esc(search)}">
  <td>${esc(l.quarter || "—")}</td>
  <td>${esc(l.date)}</td>
  <td><div class="fund">${esc(l.fund)}</div><div>${esc(l.title)}</div></td>
  <td>${esc(l.manager)}</td>
  <td>${pills(l.tickers, "pill")}</td>
  <td>${pills(l.themes, "theme")}</td>
  <td class="quick">${esc(l.quick_take || "—")}</td>
  <td>${stancePills(l.pitches)}</td>
  <td>${esc(l.geo || l.region || "—")}</td>
  <td class="actions">
    <a href="${esc(pdfHref(l))}" target="_blank" rel="noopener">View PDF</a><br>
    <a href="${esc(letterHref(l.id))}">Analysis</a>
  </td>
</tr>`;
    })
    .join("\n");

  const body = `${topNav(false)}
<form class="filters" id="filters">
  <input id="q" type="search" placeholder="Search fund, manager, ticker, theme">
  <select id="fund">${options(funds, "All funds")}</select>
  <select id="ticker">${options(tickers, "All tickers")}</select>
  <select id="theme">${options(themes, "All themes")}</select>
  <select id="geo">${options(geos, "All geos")}</select>
</form>
<p class="meta-line"><span id="count">${letters.length}</span> letters · last built ${esc(payload.generated_at.slice(0, 16).replace("T", " "))} UTC · ${esc(payload.cadence)}</p>
<div class="table-wrap">
  <table class="letters">
    <thead>
      <tr>
        <th>Quarter</th>
        <th>Date</th>
        <th>Fund</th>
        <th>Manager</th>
        <th>Tickers</th>
        <th>Themes</th>
        <th>Quick take</th>
        <th>Pitches</th>
        <th>Geo</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td class="empty" colspan="10">No letters yet. Run the Letters desk workflow.</td></tr>`}
    </tbody>
  </table>
</div>
<footer id="about">
  <p>Library grows only from public PDFs listed in <code>config/funds.json</code>. Send a fund name and letter URL to add more. No DigitalOcean. Google Sheet remains a separate optional daily job.</p>
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
    .map((p) => {
      const name = p.company || p.ticker || "Pitch";
      return `<article class="pitch">
        <header>
          <h3>${esc(name)}</h3>
          <span class="stance ${esc(p.stance)}">${esc(p.stance)}</span>
        </header>
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
    <label><input type="checkbox" id="shortlist"> Shortlist</label>
    <label><input type="checkbox" id="archive"> Archive</label>
  </div>
  <section class="cards">
    <div class="card"><h2>Tickers</h2>${pills(letter.tickers, "pill")}</div>
    <div class="card"><h2>Themes</h2>${pills(letter.themes, "theme")}</div>
    <div class="card span-2"><h2>Quick take</h2><p class="take">${esc(letter.quick_take || "No short take extracted. Open the PDF.")}</p></div>
  </section>
  <h2>Pitches</h2>
  ${pitches || `<p class="subhead">No named long/short write-up extracted. That is intentional — the whole letter is not treated as a pitch. Read the PDF.</p>`}
  <h2>PDF</h2>
  <p class="subhead"><a href="${esc(localPdf)}">PDF on this site</a> · <a href="${esc(letter.pdf_url)}">Issuer original</a></p>
  <iframe class="pdf-frame" title="Letter PDF" src="${esc(localPdf)}"></iframe>
</main>
<script>
(function () {
  const id = ${JSON.stringify(letter.id)};
  function key(kind) { return "letters-desk:" + kind; }
  function load(kind) {
    try { return JSON.parse(localStorage.getItem(key(kind)) || "[]"); } catch { return []; }
  }
  function save(kind, ids) { localStorage.setItem(key(kind), JSON.stringify(ids)); }
  function bind(kind, el) {
    if (!el) return;
    el.checked = load(kind).includes(id);
    el.addEventListener("change", function () {
      const ids = new Set(load(kind));
      if (el.checked) ids.add(id); else ids.delete(id);
      save(kind, [...ids]);
    });
  }
  bind("shortlist", document.getElementById("shortlist"));
  bind("archive", document.getElementById("archive"));
})();
</script>`;
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

export function writeSite(opts: {
  siteDir: string;
  staticDir: string;
  letters: LetterRecord[];
  cadence: string;
}): SitePayload {
  const payload: SitePayload = {
    generated_at: new Date().toISOString(),
    cadence: opts.cadence,
    letters: opts.letters,
  };
  fs.mkdirSync(path.join(opts.siteDir, "letters"), { recursive: true });
  fs.mkdirSync(path.join(opts.siteDir, "pdfs"), { recursive: true });
  fs.copyFileSync(path.join(opts.staticDir, "styles.css"), path.join(opts.siteDir, "styles.css"));
  fs.copyFileSync(path.join(opts.staticDir, "app.js"), path.join(opts.siteDir, "app.js"));
  fs.writeFileSync(path.join(opts.siteDir, ".nojekyll"), "");
  fs.writeFileSync(path.join(opts.siteDir, "letters.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(opts.siteDir, "index.html"), indexHtml(payload));
  for (const letter of opts.letters) {
    fs.writeFileSync(
      path.join(opts.siteDir, "letters", `${letter.id}.html`),
      letterHtml(letter),
    );
  }
  return payload;
}
