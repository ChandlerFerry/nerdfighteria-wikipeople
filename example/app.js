// HTML-escape to prevent XSS
function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function api(path, params = {}) {
  const url = new URL(path, CONFIG.API_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// --- Card rendering ---

function renderCard(entity) {
  const links = [];
  if (entity.wikipedia) {
    links.push(`<a href="${esc(entity.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a>`);
  }
  if (entity.wikidata) {
    links.push(`<a href="${esc(entity.wikidata)}" target="_blank" rel="noopener">Wikidata</a>`);
  }

  return `<div class="card">
    <div class="card-label">${esc(entity.label)}</div>
    ${entity.description ? `<div class="card-description">${esc(entity.description)}</div>` : ""}
    <div class="card-meta">
      <span class="badge badge-${esc(entity.category)}">${esc(entity.category)}</span>
      <span class="sitelinks">${entity.sitelink_count} sitelinks</span>
      ${entity.pageviews ? `<span class="pageviews">${entity.pageviews.toLocaleString()} views</span>` : ""}
      <span class="card-links">${links.join(" ")}</span>
    </div>
  </div>`;
}

// --- Autocomplete ---

const searchInput = document.getElementById("search-input");
const dropdown = document.getElementById("autocomplete-dropdown");
let activeIndex = -1;
let suggestions = [];

const fetchAutocomplete = debounce(async (query) => {
  if (query.length < 2) {
    hideDropdown();
    return;
  }
  try {
    suggestions = await api("/autocomplete", { q: query, limit: 10 });
    if (suggestions.length === 0) {
      hideDropdown();
      return;
    }
    activeIndex = -1;
    dropdown.innerHTML = suggestions
      .map(
        (s, i) =>
          `<div class="autocomplete-item" data-index="${i}">
            <span class="label">${esc(s.label)}</span>
            <span class="description">${esc(s.description)}</span>
          </div>`
      )
      .join("");
    dropdown.classList.add("visible");
  } catch {
    hideDropdown();
  }
}, 300);

function hideDropdown() {
  dropdown.classList.remove("visible");
  suggestions = [];
  activeIndex = -1;
}

searchInput.addEventListener("input", (e) => {
  fetchAutocomplete(e.target.value.trim());
});

searchInput.addEventListener("keydown", (e) => {
  if (!dropdown.classList.contains("visible")) {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
    return;
  }

  const items = dropdown.querySelectorAll(".autocomplete-item");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, -1);
    updateActive(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      searchInput.value = suggestions[activeIndex].label;
    }
    hideDropdown();
    doSearch();
  } else if (e.key === "Escape") {
    hideDropdown();
  }
});

function updateActive(items) {
  items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
}

dropdown.addEventListener("click", (e) => {
  const item = e.target.closest(".autocomplete-item");
  if (!item) return;
  const idx = Number(item.dataset.index);
  searchInput.value = suggestions[idx].label;
  hideDropdown();
  doSearch();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".autocomplete-wrapper")) hideDropdown();
});

// --- Search ---

const categorySelect = document.getElementById("category-select");
const searchBtn = document.getElementById("search-btn");
const resultsSection = document.getElementById("results-section");
const resultsInfo = document.getElementById("results-info");
const resultsGrid = document.getElementById("results-grid");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

let currentSearch = { q: "", category: "", limit: 20, offset: 0 };

searchBtn.addEventListener("click", () => doSearch());

async function doSearch(offset = 0) {
  searchInput.value = searchInput.value.trim();
  const q = searchInput.value;
  if (q.length < 2) return;

  currentSearch = { q, category: categorySelect.value, limit: 20, offset };

  resultsSection.style.display = "block";
  resultsGrid.innerHTML = `<div class="status">Searching…</div>`;
  resultsInfo.textContent = "";
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    const data = await api("/search", currentSearch);
    if (data.results.length === 0) {
      resultsGrid.innerHTML = `<div class="status">No results found.</div>`;
      resultsInfo.textContent = "0 results";
      return;
    }
    resultsGrid.innerHTML = data.results.map(renderCard).join("");
    const start = data.offset + 1;
    const end = data.offset + data.results.length;
    resultsInfo.textContent = `${start}\u2013${end} of ${data.total.toLocaleString()}`;
    prevBtn.disabled = data.offset === 0;
    nextBtn.disabled = data.offset + data.limit >= data.total;
  } catch (err) {
    resultsGrid.innerHTML = `<div class="status error">Error: ${esc(err.message)}</div>`;
  }
}

prevBtn.addEventListener("click", () => {
  doSearch(Math.max(0, currentSearch.offset - currentSearch.limit));
});

nextBtn.addEventListener("click", () => {
  doSearch(currentSearch.offset + currentSearch.limit);
});

// --- Random browse ---

const randomGrid = document.getElementById("random-grid");
const shuffleBtn = document.getElementById("shuffle-btn");
const minPageviewsInput = document.getElementById("min-pageviews");
const maxPageviewsInput = document.getElementById("max-pageviews");

async function loadRandom() {
  randomGrid.innerHTML = `<div class="status" style="grid-column:1/-1">Loading…</div>`;
  try {
    const data = await api("/random", {
      n: 8,
      min_pageviews: minPageviewsInput.value,
      max_pageviews: maxPageviewsInput.value,
    });
    const CATEGORY_LABELS = {
      humans: "humans",
      fictional: "fictional",
      apocryphal: "apocryphal",
    };
    randomGrid.innerHTML = ["humans", "fictional", "apocryphal"]
      .map(
        (cat) => `
        <div class="random-column">
          <h3><span class="badge badge-${cat}">${CATEGORY_LABELS[cat]}</span>${categoryCounts[cat] ? ` <span class="category-count">${formatCount(categoryCounts[cat])}</span>` : ""}</h3>
          <div class="cards">${data[cat].map(renderCard).join("")}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    randomGrid.innerHTML = `<div class="status error" style="grid-column:1/-1">Error: ${esc(err.message)}</div>`;
  }
}

shuffleBtn.addEventListener("click", loadRandom);

// --- Init ---
let categoryCounts = {};

async function loadStats() {
  try {
    categoryCounts = await api("/stats");
  } catch {
    // non-critical, counts just won't show
  }
}

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

loadStats().then(loadRandom);
