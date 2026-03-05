const STORAGE_KEY = "signalstream-rss-studio::state";
const DEFAULT_REFRESH_MINUTES = 15;
const DEFAULT_MAX_ITEMS = 20;

const STARTER_FEEDS = [
  { name: "Hacker News", url: "https://hnrss.org/frontpage", accent: "#0f8fda", customName: false },
  {
    name: "NYT Technology",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    accent: "#0da58f",
    customName: false,
  },
  {
    name: "NASA Breaking News",
    url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    accent: "#f08a24",
    customName: false,
  },
];

const appRoot = document.getElementById("app");

const runtime = {
  loadingFeedIds: new Set(),
  refreshTimerId: null,
  clockTimerId: null,
  nextRefreshAt: null,
  isRefreshingAll: false,
  toast: null,
  toastTimerId: null,
};

let state = loadState();

appRoot.addEventListener("submit", handleSubmit);
appRoot.addEventListener("click", handleClick);
appRoot.addEventListener("input", handleInput);

render();
restartAutoRefresh();
if (shouldInitialRefresh()) {
  void refreshAllFeeds({ silent: true });
}
startCountdownTicker();

function createDefaultState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    feeds: STARTER_FEEDS.map((feed) => ({
      id: uniqueId("feed"),
      name: feed.name,
      url: feed.url,
      accent: feed.accent,
      customName: Boolean(feed.customName),
      items: [],
      lastFetchedAt: null,
      lastError: "",
      createdAt: now,
      updatedAt: now,
    })),
    settings: {
      refreshMinutes: DEFAULT_REFRESH_MINUTES,
      maxItemsPerFeed: DEFAULT_MAX_ITEMS,
      autoRefresh: true,
    },
    ui: {
      activeFeedId: "all",
      search: "",
    },
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createDefaultState();
    persistState(initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = sanitizeState(parsed);
    if (!normalized) {
      throw new Error("Invalid state");
    }
    return normalized;
  } catch {
    const fallback = createDefaultState();
    persistState(fallback);
    return fallback;
  }
}

function sanitizeState(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const feeds = Array.isArray(input.feeds)
    ? input.feeds
        .filter((feed) => feed && typeof feed.url === "string")
        .map((feed) => {
          const items = Array.isArray(feed.items)
            ? feed.items
                .filter((item) => item && typeof item.title === "string" && typeof item.link === "string")
                .map((item) => ({
                  id: String(item.id || uniqueId("item")),
                  title: String(item.title || "Untitled"),
                  link: String(item.link || ""),
                  summary: String(item.summary || "").slice(0, 420),
                  publishedAt: String(item.publishedAt || ""),
                }))
            : [];

          return {
            id: String(feed.id || uniqueId("feed")),
            name: String(feed.name || "Untitled Feed").slice(0, 64),
            url: String(feed.url || ""),
            accent: normalizeColor(feed.accent),
            customName: Boolean(feed.customName),
            items,
            lastFetchedAt: feed.lastFetchedAt ? String(feed.lastFetchedAt) : null,
            lastError: String(feed.lastError || ""),
            createdAt: String(feed.createdAt || new Date().toISOString()),
            updatedAt: String(feed.updatedAt || new Date().toISOString()),
          };
        })
    : [];

  const settings = {
    refreshMinutes: clampNumber(Number(input.settings?.refreshMinutes || DEFAULT_REFRESH_MINUTES), 1, 180),
    maxItemsPerFeed: clampNumber(Number(input.settings?.maxItemsPerFeed || DEFAULT_MAX_ITEMS), 5, 80),
    autoRefresh: input.settings?.autoRefresh !== false,
  };

  const ui = {
    activeFeedId: String(input.ui?.activeFeedId || "all"),
    search: String(input.ui?.search || "").slice(0, 120),
  };

  return {
    version: Number(input.version || 1),
    feeds,
    settings,
    ui,
  };
}

function persistState(nextState = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function saveState() {
  persistState(state);
}

function shouldInitialRefresh() {
  if (!state.feeds.length) {
    return false;
  }
  return state.feeds.some((feed) => !Array.isArray(feed.items) || feed.items.length === 0);
}

function render() {
  const stats = getStats();
  const visibleArticles = getVisibleArticles();
  const feedOptions = state.feeds
    .map(
      (feed) =>
        `<option value="${escapeHtml(feed.id)}" ${state.ui.activeFeedId === feed.id ? "selected" : ""}>${escapeHtml(
          feed.name
        )}</option>`
    )
    .join("");

  appRoot.innerHTML = `
    <div class="app-shell">
      <header class="panel hero animate-in">
        <h1 class="header-title">SignalStream RSS Studio</h1>
        <p class="header-subtitle">A focused RSS desk for tracking the sources that matter, without visual noise.</p>
        <div class="hero-actions">
          <button class="btn secondary" type="button" data-action="refresh-all">${
            runtime.isRefreshingAll ? "Refreshing..." : "Refresh Now"
          }</button>
          <span class="badge ${runtime.isRefreshingAll ? "warn" : "success"}">${
            runtime.isRefreshingAll ? "Updating feeds" : "Auto-sync active"
          }</span>
          <span class="badge quiet" id="nextRefreshLabel">${escapeHtml(getNextRefreshText())}</span>
        </div>
      </header>

      ${runtime.toast ? `<div class="toast ${escapeHtml(runtime.toast.type)}">${escapeHtml(runtime.toast.message)}</div>` : ""}

      <section class="panel command animate-in">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Add Feed</h2>
            <p class="panel-subtitle">Paste an RSS/Atom URL, set accent, and start streaming updates.</p>
          </div>
        </div>

        <form id="addFeedForm" class="command-form">
          <div class="field">
            <label for="feedName">Name</label>
            <input id="feedName" name="name" maxlength="64" placeholder="e.g. Product Engineering Blog" />
          </div>
          <div class="field wide">
            <label for="feedUrl">Feed URL</label>
            <input id="feedUrl" name="url" type="url" required placeholder="https://example.com/feed.xml" />
          </div>
          <div class="field accent-field">
            <label for="feedAccent">Accent</label>
            <input id="feedAccent" name="accent" type="color" value="#0f8fda" />
          </div>
          <button class="btn primary add-btn" type="submit">Add Feed</button>
        </form>

        <div class="stats-line">
          <span class="metric">Feeds <strong>${stats.feedCount}</strong></span>
          <span class="metric">Visible <strong>${stats.visibleArticleCount}</strong></span>
          <span class="metric">Healthy <strong>${stats.healthyFeedCount}</strong></span>
          <span class="metric">Failed <strong>${stats.failedFeedCount}</strong></span>
        </div>

        <details class="settings-wrap">
          <summary>Advanced refresh settings</summary>
          <form id="settingsForm" class="form-grid two">
            <div class="field">
              <label for="refreshMinutes">Refresh Every</label>
              <select id="refreshMinutes" name="refreshMinutes">
                ${[1, 5, 10, 15, 30, 60, 120].map((value) => `<option value="${value}" ${state.settings.refreshMinutes === value ? "selected" : ""}>${value} min</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="maxItems">Items Per Feed</label>
              <select id="maxItems" name="maxItemsPerFeed">
                ${[10, 20, 30, 40, 60].map((value) => `<option value="${value}" ${state.settings.maxItemsPerFeed === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </div>
            <div class="field checkline">
              <label>
                <input name="autoRefresh" type="checkbox" ${state.settings.autoRefresh ? "checked" : ""} />
                Auto-refresh feeds periodically
              </label>
            </div>
            <div class="btn-row">
              <button class="btn primary" type="submit">Save Settings</button>
              <button class="btn ghost" type="button" data-action="add-starters">Add Starter Feeds</button>
            </div>
          </form>
        </details>
      </section>

      <section class="panel feedbank animate-in">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Feed Bank</h2>
            <p class="panel-subtitle">Select, refresh, or remove sources.</p>
          </div>
        </div>

        <div class="feed-list">
          ${
            state.feeds.length
              ? state.feeds.map((feed, index) => renderFeedCard(feed, index)).join("")
              : '<div class="empty">No feeds yet. Add one to begin tracking updates.</div>'
          }
        </div>
      </section>

      <section class="panel explorer animate-in">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Article Stream</h2>
            <p class="panel-subtitle">Search and filter your incoming feed stories.</p>
          </div>
        </div>

        <div class="toolbar-grid">
          <input id="searchText" value="${escapeHtml(state.ui.search)}" placeholder="Search headlines, summaries, or source names" />
          <select id="feedFilter">
            <option value="all" ${state.ui.activeFeedId === "all" ? "selected" : ""}>All Feeds</option>
            ${feedOptions}
          </select>
          <button class="btn ghost" type="button" data-action="clear-filters">Clear</button>
        </div>

        ${
          visibleArticles.length
            ? `<div class="article-grid">${visibleArticles.map((article, index) => renderArticleCard(article, index)).join("")}</div>`
            : '<div class="empty">No articles match your current view. Try refreshing feeds or clearing filters.</div>'
        }
      </section>
    </div>
  `;

  updateCountdownLabel();
}

function renderFeedCard(feed, index = 0) {
  const isActive = state.ui.activeFeedId === feed.id;
  const loading = runtime.loadingFeedIds.has(feed.id);
  const lastFetchedText = feed.lastFetchedAt ? `Updated ${timeAgo(feed.lastFetchedAt)}` : "Never fetched";
  const safeAccent = normalizeColor(feed.accent);

  return `
    <article class="feed-card ${isActive ? "active" : ""}" style="--stagger:${index}; border-left-color: ${escapeHtml(safeAccent)};">
      <div>
        <h3 class="feed-title">${escapeHtml(feed.name)}</h3>
        <p class="feed-url">${escapeHtml(feed.url)}</p>
      </div>
      <p class="feed-meta">${escapeHtml(lastFetchedText)} · ${feed.items.length} items cached</p>
      ${feed.lastError ? `<p class="feed-meta" style="color: #9f3044;">Last error: ${escapeHtml(feed.lastError)}</p>` : ""}
      <div class="feed-actions">
        <button class="btn ghost" type="button" data-action="select-feed" data-feed-id="${escapeHtml(feed.id)}">${
    isActive ? "Selected" : "View"
  }</button>
        <button class="btn ghost" type="button" data-action="refresh-feed" data-feed-id="${escapeHtml(feed.id)}">${
    loading ? "Refreshing..." : "Refresh"
  }</button>
        <button class="btn danger" type="button" data-action="remove-feed" data-feed-id="${escapeHtml(feed.id)}">Remove</button>
      </div>
    </article>
  `;
}

function renderArticleCard(article, index = 0) {
  const tint = withAlpha(article.feedAccent, 0.12);
  return `
    <article class="article-card" style="--stagger:${index % 14};">
      <div class="article-head">
        <h3 class="article-title"><a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    article.title
  )}</a></h3>
        <span class="source-pill" style="background:${escapeHtml(tint)}; border-color:${escapeHtml(withAlpha(article.feedAccent, 0.42))};">${escapeHtml(
    article.feedName
  )}</span>
      </div>
      <p class="article-summary">${escapeHtml(article.summary || "No summary provided by source.")}</p>
      <p class="article-meta">Published ${escapeHtml(formatDate(article.publishedAt))}</p>
    </article>
  `;
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.id === "searchText" && target instanceof HTMLInputElement) {
    state.ui.search = target.value.slice(0, 120);
    saveState();
    render();
    return;
  }

  if (target.id === "feedFilter" && target instanceof HTMLSelectElement) {
    state.ui.activeFeedId = target.value;
    saveState();
    render();
  }
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();

  if (form.id === "addFeedForm") {
    const formData = new FormData(form);
    const nameInput = String(formData.get("name") || "").trim();
    const urlInput = String(formData.get("url") || "").trim();
    const accentInput = normalizeColor(String(formData.get("accent") || ""));

    if (!isValidHttpUrl(urlInput)) {
      setToast("Please enter a valid HTTP/HTTPS RSS URL.", "error");
      render();
      return;
    }

    const duplicate = state.feeds.some((feed) => feed.url.toLowerCase() === urlInput.toLowerCase());
    if (duplicate) {
      setToast("That feed URL is already in your list.", "error");
      render();
      return;
    }

    const now = new Date().toISOString();
    const inferred = deriveFeedNameFromUrl(urlInput);
    const feed = {
      id: uniqueId("feed"),
      name: nameInput || inferred,
      url: urlInput,
      accent: accentInput,
      customName: Boolean(nameInput),
      items: [],
      lastFetchedAt: null,
      lastError: "",
      createdAt: now,
      updatedAt: now,
    };

    state.feeds = [feed, ...state.feeds];
    state.ui.activeFeedId = feed.id;
    saveState();
    form.reset();
    setToast(`Added ${feed.name}. Fetching latest items...`, "success");
    render();
    restartAutoRefresh();
    await refreshFeed(feed.id, { silent: true });
    return;
  }

  if (form.id === "settingsForm") {
    const formData = new FormData(form);
    const refreshMinutes = clampNumber(Number(formData.get("refreshMinutes") || DEFAULT_REFRESH_MINUTES), 1, 180);
    const maxItemsPerFeed = clampNumber(Number(formData.get("maxItemsPerFeed") || DEFAULT_MAX_ITEMS), 5, 80);
    const autoRefresh = formData.has("autoRefresh");

    state.settings.refreshMinutes = refreshMinutes;
    state.settings.maxItemsPerFeed = maxItemsPerFeed;
    state.settings.autoRefresh = autoRefresh;

    saveState();
    restartAutoRefresh();
    setToast("Update settings saved.", "success");
    render();
  }
}

async function handleClick(event) {
  const trigger = event.target instanceof HTMLElement ? event.target.closest("[data-action]") : null;
  if (!trigger) {
    return;
  }

  const action = trigger.dataset.action;
  const feedId = trigger.dataset.feedId;

  if (action === "clear-filters") {
    state.ui.search = "";
    state.ui.activeFeedId = "all";
    saveState();
    render();
    return;
  }

  if (action === "select-feed" && feedId) {
    state.ui.activeFeedId = feedId;
    saveState();
    render();
    return;
  }

  if (action === "remove-feed" && feedId) {
    const feed = state.feeds.find((item) => item.id === feedId);
    if (!feed) {
      return;
    }
    const confirmed = window.confirm(`Remove feed \"${feed.name}\"?`);
    if (!confirmed) {
      return;
    }

    state.feeds = state.feeds.filter((item) => item.id !== feedId);
    if (state.ui.activeFeedId === feedId) {
      state.ui.activeFeedId = "all";
    }

    saveState();
    restartAutoRefresh();
    setToast(`Removed ${feed.name}.`, "success");
    render();
    return;
  }

  if (action === "refresh-feed" && feedId) {
    await refreshFeed(feedId, { silent: false });
    return;
  }

  if (action === "refresh-all") {
    await refreshAllFeeds({ silent: false });
    return;
  }

  if (action === "add-starters") {
    let added = 0;
    STARTER_FEEDS.forEach((starter) => {
      if (state.feeds.some((feed) => feed.url.toLowerCase() === starter.url.toLowerCase())) {
        return;
      }
      const now = new Date().toISOString();
      state.feeds.push({
        id: uniqueId("feed"),
        name: starter.name,
        url: starter.url,
        accent: starter.accent,
        customName: false,
        items: [],
        lastFetchedAt: null,
        lastError: "",
        createdAt: now,
        updatedAt: now,
      });
      added += 1;
    });

    if (!added) {
      setToast("Starter feeds are already present.", "warn");
      render();
      return;
    }

    saveState();
    restartAutoRefresh();
    setToast(`Added ${added} starter feed${added > 1 ? "s" : ""}.`, "success");
    render();
    await refreshAllFeeds({ silent: true });
  }
}

async function refreshAllFeeds({ silent = false } = {}) {
  if (runtime.isRefreshingAll) {
    return;
  }

  if (!state.feeds.length) {
    if (!silent) {
      setToast("No feeds available to refresh.", "warn");
      render();
    }
    return;
  }

  runtime.isRefreshingAll = true;
  render();

  let successCount = 0;
  let failCount = 0;

  for (const feed of state.feeds) {
    const ok = await refreshFeed(feed.id, { silent: true });
    if (ok) {
      successCount += 1;
    } else {
      failCount += 1;
    }
  }

  runtime.isRefreshingAll = false;
  scheduleNextRefresh();

  if (!silent) {
    if (failCount === 0) {
      setToast(`Refresh complete: ${successCount} feeds updated.`, "success");
    } else {
      setToast(`Refresh complete: ${successCount} updated, ${failCount} failed.`, "warn");
    }
  }

  render();
}

async function refreshFeed(feedId, { silent = false } = {}) {
  const feed = state.feeds.find((item) => item.id === feedId);
  if (!feed) {
    return false;
  }

  runtime.loadingFeedIds.add(feed.id);
  render();

  try {
    const payload = await loadFeedPayload(feed.url);
    const parsed = payload.type === "rss2json" ? parseRss2JsonPayload(payload.data, feed) : parseXmlPayload(payload.text, feed);

    feed.items = normalizeItems(parsed.items).slice(0, state.settings.maxItemsPerFeed);
    if (!feed.customName && parsed.title) {
      feed.name = parsed.title.slice(0, 64);
    }
    feed.lastFetchedAt = new Date().toISOString();
    feed.lastError = "";
    feed.updatedAt = new Date().toISOString();

    saveState();
    if (!silent) {
      setToast(`${feed.name} updated with ${feed.items.length} items.`, "success");
    }
    return true;
  } catch (error) {
    feed.lastError = String(error.message || "Unknown error").slice(0, 180);
    feed.updatedAt = new Date().toISOString();
    saveState();
    if (!silent) {
      setToast(`Failed to refresh ${feed.name}: ${feed.lastError}`, "error");
    }
    return false;
  } finally {
    runtime.loadingFeedIds.delete(feed.id);
    render();
  }
}

async function loadFeedPayload(feedUrl) {
  const attempts = [
    async () => {
      const response = await fetch(feedUrl, {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Direct fetch returned ${response.status}`);
      }
      const text = await response.text();
      return { type: "xml", text };
    },
    async () => {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
      const response = await fetch(proxyUrl, {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Proxy fetch returned ${response.status}`);
      }
      const text = await response.text();
      return { type: "xml", text };
    },
    async () => {
      const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`JSON fallback returned ${response.status}`);
      }
      const data = await response.json();
      if (data.status && data.status !== "ok") {
        throw new Error(data.message || "JSON fallback error");
      }
      return { type: "rss2json", data };
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const payload = await attempt();
      if (payload.type === "xml") {
        const text = String(payload.text || "").trim();
        if (!text) {
          throw new Error("Feed response is empty");
        }
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Could not fetch feed data");
}

function parseXmlPayload(xmlText, feed) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(xmlText || ""), "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Feed format could not be parsed");
  }

  const rssChannel = doc.querySelector("channel");
  if (rssChannel) {
    const title = readNodeText(rssChannel.querySelector("title")) || feed.name;
    const items = [...rssChannel.querySelectorAll("item")].map((node, index) => ({
      id: readNodeText(node.querySelector("guid")) || `${feed.id}-rss-${index}`,
      title: readNodeText(node.querySelector("title")) || "Untitled article",
      link: readNodeText(node.querySelector("link")) || feed.url,
      summary: cleanSnippet(
        readNodeText(node.querySelector("description")) || readNodeText(node.querySelector("content\\:encoded")) || ""
      ),
      publishedAt: normalizeDate(
        readNodeText(node.querySelector("pubDate")) || readNodeText(node.querySelector("dc\\:date")) || new Date().toISOString()
      ),
    }));

    return { title, items };
  }

  const atomFeed = doc.querySelector("feed");
  if (atomFeed) {
    const title = readNodeText(atomFeed.querySelector("title")) || feed.name;
    const items = [...atomFeed.querySelectorAll("entry")].map((entry, index) => {
      const linkNode = entry.querySelector("link[rel='alternate']") || entry.querySelector("link");
      const href = linkNode?.getAttribute("href") || readNodeText(linkNode) || feed.url;
      return {
        id: readNodeText(entry.querySelector("id")) || `${feed.id}-atom-${index}`,
        title: readNodeText(entry.querySelector("title")) || "Untitled article",
        link: href,
        summary: cleanSnippet(readNodeText(entry.querySelector("summary")) || readNodeText(entry.querySelector("content")) || ""),
        publishedAt: normalizeDate(
          readNodeText(entry.querySelector("updated")) || readNodeText(entry.querySelector("published")) || new Date().toISOString()
        ),
      };
    });

    return { title, items };
  }

  throw new Error("Unsupported feed format (not RSS/Atom)");
}

function parseRss2JsonPayload(data, feed) {
  const items = Array.isArray(data.items)
    ? data.items.map((item, index) => ({
        id: String(item.guid || item.link || `${feed.id}-json-${index}`),
        title: String(item.title || "Untitled article"),
        link: String(item.link || feed.url),
        summary: cleanSnippet(String(item.description || item.content || "")),
        publishedAt: normalizeDate(String(item.pubDate || item.published || new Date().toISOString())),
      }))
    : [];

  return {
    title: String(data.feed?.title || feed.name),
    items,
  };
}

function normalizeItems(items) {
  const seen = new Set();
  return items
    .filter((item) => item && item.title && item.link)
    .map((item) => ({
      id: String(item.id || uniqueId("item")),
      title: String(item.title || "Untitled article").slice(0, 220),
      link: String(item.link || ""),
      summary: String(item.summary || "").slice(0, 420),
      publishedAt: normalizeDate(item.publishedAt),
    }))
    .filter((item) => {
      const key = `${item.link}::${item.title}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
}

function getVisibleArticles() {
  const activeFeedId = state.ui.activeFeedId;
  const search = state.ui.search.trim().toLowerCase();

  const rows = state.feeds.flatMap((feed) =>
    feed.items.map((item) => ({
      ...item,
      feedId: feed.id,
      feedName: feed.name,
      feedAccent: feed.accent,
    }))
  );

  return rows
    .filter((item) => {
      if (activeFeedId !== "all" && item.feedId !== activeFeedId) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = `${item.title} ${item.summary} ${item.feedName}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
}

function getStats() {
  const allArticles = state.feeds.reduce((count, feed) => count + feed.items.length, 0);
  const visibleArticleCount = getVisibleArticles().length;
  const failedFeedCount = state.feeds.filter((feed) => feed.lastError).length;
  return {
    feedCount: state.feeds.length,
    totalArticleCount: allArticles,
    visibleArticleCount,
    failedFeedCount,
    healthyFeedCount: Math.max(0, state.feeds.length - failedFeedCount),
  };
}

function restartAutoRefresh() {
  if (runtime.refreshTimerId) {
    clearInterval(runtime.refreshTimerId);
    runtime.refreshTimerId = null;
  }

  if (!state.settings.autoRefresh || !state.feeds.length) {
    runtime.nextRefreshAt = null;
    updateCountdownLabel();
    return;
  }

  const intervalMs = state.settings.refreshMinutes * 60 * 1000;
  runtime.nextRefreshAt = Date.now() + intervalMs;
  runtime.refreshTimerId = window.setInterval(async () => {
    await refreshAllFeeds({ silent: true });
    runtime.nextRefreshAt = Date.now() + intervalMs;
    updateCountdownLabel();
  }, intervalMs);

  updateCountdownLabel();
}

function scheduleNextRefresh() {
  if (!state.settings.autoRefresh || !state.feeds.length) {
    runtime.nextRefreshAt = null;
    updateCountdownLabel();
    return;
  }
  runtime.nextRefreshAt = Date.now() + state.settings.refreshMinutes * 60 * 1000;
  updateCountdownLabel();
}

function startCountdownTicker() {
  if (runtime.clockTimerId) {
    clearInterval(runtime.clockTimerId);
  }
  runtime.clockTimerId = window.setInterval(() => {
    updateCountdownLabel();
  }, 1000);
}

function updateCountdownLabel() {
  const element = document.getElementById("nextRefreshLabel");
  if (!element) {
    return;
  }
  element.textContent = getNextRefreshText();
}

function getNextRefreshText() {
  if (!state.settings.autoRefresh) {
    return "Auto refresh paused";
  }
  if (!runtime.nextRefreshAt) {
    return "Waiting for first cycle";
  }

  const diffMs = Math.max(0, runtime.nextRefreshAt - Date.now());
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  return `Next refresh in ${minutes}:${seconds}`;
}

function setToast(message, type = "success") {
  runtime.toast = {
    message: String(message || ""),
    type,
  };

  if (runtime.toastTimerId) {
    clearTimeout(runtime.toastTimerId);
  }

  runtime.toastTimerId = window.setTimeout(() => {
    runtime.toast = null;
    render();
  }, 3200);
}

function readNodeText(node) {
  return node?.textContent?.trim() || "";
}

function cleanSnippet(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const scratch = document.createElement("div");
  scratch.innerHTML = text;
  const plain = (scratch.textContent || "").replace(/\s+/g, " ").trim();
  return plain.slice(0, 380);
}

function normalizeDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function timeAgo(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(diffSeconds) < 60) {
    return "just now";
  }

  const ranges = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Infinity, "year"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let index = 1; index < ranges.length; index += 1) {
    const [threshold, unit] = ranges[index];
    if (Math.abs(diffSeconds) < threshold) {
      const [step] = ranges[index - 1];
      return formatter.format(Math.round(diffSeconds / step), unit);
    }
  }

  return "just now";
}

function deriveFeedNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return `${host} feed`;
  } catch {
    return "Custom Feed";
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function withAlpha(hexColor, alpha) {
  const hex = normalizeColor(hexColor).replace("#", "");
  const int = Number.parseInt(hex, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizeColor(value) {
  const text = String(value || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
    return "#0f8fda";
  }
  return text.toLowerCase();
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
