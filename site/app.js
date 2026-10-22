(function () {
  const STORAGE_KEY = "letters-desk:v1";

  function emptyState() {
    return { shortlist: {}, archive: {} };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          shortlist: parsed.shortlist && typeof parsed.shortlist === "object" ? parsed.shortlist : {},
          archive: parsed.archive && typeof parsed.archive === "object" ? parsed.archive : {},
        };
      }
    } catch {
      /* migrate below */
    }
    const migrated = emptyState();
    for (const kind of ["shortlist", "archive"]) {
      try {
        const ids = JSON.parse(localStorage.getItem("letters-desk:" + kind) || "[]");
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (id) migrated[kind][id] = true;
          }
        }
      } catch {
        /* ignore */
      }
    }
    return migrated;
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const state = loadState();

  function bindFlags(root) {
    const boxes = (root || document).querySelectorAll("input[data-flag][data-id]");
    for (const el of boxes) {
      const flag = el.getAttribute("data-flag");
      const id = el.getAttribute("data-id");
      if (flag !== "shortlist" && flag !== "archive") continue;
      if (!id) continue;
      el.checked = Boolean(state[flag][id]);
      el.addEventListener("change", function () {
        if (el.checked) state[flag][id] = true;
        else delete state[flag][id];
        saveState(state);
        applyFilters();
      });
    }
  }

  const table = document.querySelector("table.letters tbody");
  const q = document.getElementById("q");
  const ticker = document.getElementById("ticker");
  const theme = document.getElementById("theme");
  const geo = document.getElementById("geo");
  const fund = document.getElementById("fund");
  const flags = document.getElementById("flags");
  const count = document.getElementById("count");
  const rows = table ? [...table.querySelectorAll("tr[data-letter]")] : [];

  function val(el) {
    return (el && el.value ? el.value : "").trim().toLowerCase();
  }

  function applyFilters() {
    if (!table) return;
    const query = val(q);
    const t = val(ticker);
    const th = val(theme);
    const g = val(geo);
    const f = val(fund);
    const flagMode = val(flags);
    let shownLetters = 0;
    for (const row of rows) {
      const id = row.getAttribute("data-pitch") || row.getAttribute("data-letter") || "";
      const letterId = row.getAttribute("data-letter") || "";
      const hay = (row.getAttribute("data-search") || "").toLowerCase();
      const archived = Boolean(state.archive[id] || state.archive[letterId]);
      const shortlisted = Boolean(state.shortlist[id] || (row.classList.contains("letter-row") && state.shortlist[letterId]));
      row.classList.toggle("archived-row", Boolean(state.archive[id]));
      const ok =
        (!query || hay.includes(query)) &&
        (!t || (row.getAttribute("data-tickers") || "").toLowerCase().split("|").includes(t)) &&
        (!th || (row.getAttribute("data-themes") || "").toLowerCase().split("|").includes(th)) &&
        (!g || (row.getAttribute("data-geo") || "").toLowerCase().includes(g)) &&
        (!f || (row.getAttribute("data-fund") || "").toLowerCase() === f) &&
        (flagMode !== "shortlist" || shortlisted) &&
        (flagMode !== "hide-archive" || !archived) &&
        (flagMode !== "archive" || archived);
      row.classList.toggle("hidden-row", !ok);
      if (ok && row.classList.contains("letter-row")) shownLetters += 1;
    }
    if (count) count.textContent = String(shownLetters);
  }

  bindFlags(document);
  for (const el of [q, ticker, theme, geo, fund, flags]) {
    if (!el) continue;
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  }
  applyFilters();
})();
