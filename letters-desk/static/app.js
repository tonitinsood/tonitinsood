(function () {
  const table = document.querySelector("table.letters tbody");
  if (!table) return;
  const q = document.getElementById("q");
  const ticker = document.getElementById("ticker");
  const theme = document.getElementById("theme");
  const geo = document.getElementById("geo");
  const fund = document.getElementById("fund");
  const count = document.getElementById("count");
  const rows = [...table.querySelectorAll("tr[data-letter]")];

  function val(el) {
    return (el && el.value ? el.value : "").trim().toLowerCase();
  }

  function apply() {
    const query = val(q);
    const t = val(ticker);
    const th = val(theme);
    const g = val(geo);
    const f = val(fund);
    let shown = 0;
    for (const row of rows) {
      const hay = (row.getAttribute("data-search") || "").toLowerCase();
      const ok =
        (!query || hay.includes(query)) &&
        (!t || (row.getAttribute("data-tickers") || "").toLowerCase().split("|").includes(t)) &&
        (!th || (row.getAttribute("data-themes") || "").toLowerCase().split("|").includes(th)) &&
        (!g || (row.getAttribute("data-geo") || "").toLowerCase().includes(g)) &&
        (!f || (row.getAttribute("data-fund") || "").toLowerCase() === f);
      row.classList.toggle("hidden-row", !ok);
      if (ok) shown += 1;
    }
    if (count) count.textContent = String(shown);
  }

  for (const el of [q, ticker, theme, geo, fund]) {
    if (!el) continue;
    el.addEventListener("input", apply);
    el.addEventListener("change", apply);
  }
  apply();
})();
