"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PerformanceTreemap from "./performance-treemap";

const periodBars = {
  "1D": { source: "intradayHistory", session: true },
  "1W": { source: "hourlyHistory", days: 7 },
  "1M": { source: "hourlyHistory", days: 31 },
  "3M": { source: "hourlyHistory", days: 93 },
  "6M": { source: "hourlyHistory", days: 186 },
  "1Y": { source: "history", days: 366 },
  "3Y": { source: "history", days: 1100 },
  "Max": { source: "maxHistory" },
};
const periodResolution = { "1D": "5-minute", "1W": "Hourly", "1M": "Hourly", "3M": "Hourly", "6M": "Hourly", "1Y": "Daily", "3Y": "Daily", "Max": "Monthly" };
const money = (value) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
const percent = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const tone = (value) => !Number.isFinite(value) ? "neutral" : value >= 0 ? "positive" : "negative";
const pageDetails = {
  overview: ["Market overview", "See the whole market picture."],
  heatmap: ["Market field", "The shape of your market."],
  focus: ["The frame", "One ticker. The complete frame."],
  watchlist: ["Your universe", "Every position, precisely organized."],
};
const WATCHLIST_CACHE_VERSION = 1;
const LIVE_REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

function watchlistCacheKey(userKey) {
  return userKey ? `aperture:watchlist:${userKey}` : "";
}

function cacheWatchlist(userKey, stocks) {
  if (!userKey) return;
  try {
    window.localStorage.setItem(watchlistCacheKey(userKey), JSON.stringify({ version: WATCHLIST_CACHE_VERSION, savedAt: Date.now(), stocks }));
  } catch {
    // Storage can be unavailable in private browsing; live data should still work.
  }
}

function timeframeSeries(stock, period) {
  const config = periodBars[period];
  let history = stock[config.source] || [];
  if (history.length < 2) history = stock.history || [];
  if (history.length < 2 || period === "Max") return history;
  if (config.session) {
    if (history === stock.history) return history.slice(-2);
    let start = 0;
    for (let index = history.length - 1; index > 0; index -= 1) {
      if (new Date(history[index].date) - new Date(history[index - 1].date) > 1000 * 60 * 60 * 2) { start = index; break; }
    }
    return history.slice(start);
  }
  const end = new Date(history.at(-1).date).getTime();
  const cutoff = end - config.days * 24 * 60 * 60 * 1000;
  return history.filter((bar) => new Date(bar.date).getTime() >= cutoff);
}

function periodReturn(stock, period) {
  const history = timeframeSeries(stock, period);
  if (history.length < 2) return null;
  const current = history.at(-1).close;
  const base = history[0]?.close;
  return base ? ((current - base) / base) * 100 : null;
}

function chartData(stocks, period) {
  const series = (stock) => timeframeSeries(stock, period);
  const available = Math.max(0, ...stocks.map((stock) => series(stock).length));
  const length = available;
  if (length < 2) return null;
  const values = Array.from({ length }, (_, index) => {
    const returns = stocks.flatMap((stock) => {
      const history = series(stock).slice(-length);
      const base = history[0]?.close;
      const alignedIndex = history.length > 1 ? Math.round((index / (length - 1)) * (history.length - 1)) : 0;
      const close = history[alignedIndex]?.close;
      return base && close ? [(close / base - 1) * 100] : [];
    });
    return returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  });
  const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const reference = stocks.map((stock) => series(stock)).sort((a, b) => b.length - a.length)[0]?.slice(-length) || [];
  const samples = values.map((value, index) => ({ value, date: reference[index]?.date, x: (index / (values.length - 1)) * 600, y: 180 - ((value - min) / spread) * 140 }));
  const points = samples.map(({ x, y }) => `${x},${y}`).join(" ");
  return { points, area: `0,220 ${points} 600,220`, current: values.at(-1), samples, showTime: periodBars[period].source === "intradayHistory" || periodBars[period].source === "hourlyHistory" };
}

function TimelineChart({ data, fillId, label }) {
  const [hover, setHover] = useState(null);
  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (data.samples.length - 1));
    const sample = data.samples[index];
    const parentRect = event.currentTarget.parentElement.getBoundingClientRect();
    setHover({ ...sample, index, left: rect.left - parentRect.left + (sample.x / 600) * rect.width, top: rect.top - parentRect.top + (sample.y / 220) * rect.height });
  };
  const date = hover?.date ? new Intl.DateTimeFormat("en-US", data.showTime ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(hover.date)) : "Date unavailable";
  return <><svg className="main-chart interactive-chart" viewBox="0 0 600 220" preserveAspectRatio="none" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)}><defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d7a57" stopOpacity=".22"/><stop offset="1" stopColor="#1d7a57" stopOpacity="0"/></linearGradient></defs><polygon points={data.area} fill={`url(#${fillId})`}/><polyline points={data.points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>{hover && <line x1={hover.x} x2={hover.x} y1="12" y2="205" className="hover-line" vectorEffect="non-scaling-stroke"/>}</svg>{hover && <><i className="chart-hover-dot" style={{ left: hover.left, top: hover.top }}/><div className={`chart-tooltip ${hover.index < 2 ? "edge-left" : hover.index > data.samples.length - 3 ? "edge-right" : ""}`} style={{ left: hover.left, top: hover.top }}><span>{date}</span><strong className={tone(hover.value)}>{percent(hover.value)}</strong></div></>}</>;
}

function ApertureMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16.5"/><path d="M18 7.3 24.2 18 18 28.7 11.8 18 18 7.3Z"/><circle cx="18" cy="18" r="4.2"/></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 6-6m-4 0h4v4"/></svg>;
}

function ThemeIcon({ dark }) {
  return dark ? <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"/></svg> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.7A7 7 0 0 1 7.3 3.2 7 7 0 1 0 16.8 12.7Z"/></svg>;
}

function ExportIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v9M5.7 7.8 9 11.1l3.3-3.3M3 13.5v2h12v-2"/></svg>;
}

export default function Dashboard({ view = "overview", initialTicker = "", userKey = "", userName = "", userEmail = "" }) {
  const router = useRouter();
  const [stocks, setStocks] = useState([]), [query, setQuery] = useState(""), [period, setPeriod] = useState("1D");
  const [focusedTicker, setFocusedTicker] = useState(initialTicker);
  const [modal, setModal] = useState(false), [ticker, setTicker] = useState(""), [notice, setNotice] = useState(""), [storage, setStorage] = useState("loading");
  const [savingTicker, setSavingTicker] = useState(false), [removingTicker, setRemovingTicker] = useState(""), [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [lastUpdated, setLastUpdated] = useState(null);
  const [online, setOnline] = useState(true), [clock, setClock] = useState(Date.now());
  const [theme, setTheme] = useState("light");
  const [movement, setMovement] = useState("all"), [assetClass, setAssetClass] = useState("all"), [sector, setSector] = useState("all"), [sortBy, setSortBy] = useState("viewedReturn"), [sortDirection, setSortDirection] = useState("desc");
  const noticeTimer = useRef(null);
  const refreshNowRef = useRef(null);
  const viewedStocks = useMemo(() => stocks.map((stock) => ({ ...stock, assetType: stock.assetType === "ETF" ? "ETF" : "Equity", viewedReturn: periodReturn(stock, period) })), [stocks, period]);
  const sectors = useMemo(() => [...new Set(viewedStocks.map((stock) => stock.sector).filter(Boolean))].sort(), [viewedStocks]);
  const shown = useMemo(() => viewedStocks
    .filter((stock) => stock.ticker.toLowerCase().includes(query.toLowerCase()) || stock.name.toLowerCase().includes(query.toLowerCase()))
    .filter((stock) => sector === "all" || stock.sector === sector)
    .filter((stock) => assetClass === "all" || stock.assetType === assetClass)
    .filter((stock) => movement === "all" || (Number.isFinite(stock.viewedReturn) && (movement === "advancing" ? stock.viewedReturn >= 0 : stock.viewedReturn < 0)))
    .sort((a, b) => {
      const aValue = sortBy === "company" ? a.ticker : a[sortBy];
      const bValue = sortBy === "company" ? b.ticker : b[sortBy];
      if (!Number.isFinite(aValue) && typeof aValue !== "string") return 1;
      if (!Number.isFinite(bValue) && typeof bValue !== "string") return -1;
      const comparison = typeof aValue === "string" ? aValue.localeCompare(bValue) : aValue - bValue;
      return sortDirection === "asc" ? comparison : -comparison;
    }), [viewedStocks, query, sector, assetClass, movement, sortBy, sortDirection]);
  const performers = useMemo(() => viewedStocks.filter((stock) => Number.isFinite(stock.viewedReturn)).sort((a, b) => b.viewedReturn - a.viewedReturn), [viewedStocks]);
  const focusedStock = useMemo(() => viewedStocks.find((stock) => stock.ticker === focusedTicker) || performers[0] || viewedStocks[0] || null, [viewedStocks, performers, focusedTicker]);
  const focusedChart = useMemo(() => focusedStock ? chartData([focusedStock], period) : null, [focusedStock, period]);
  const advancing = performers.filter((stock) => stock.viewedReturn >= 0).length;
  const watchlistReturn = performers.length ? performers.reduce((sum, stock) => sum + stock.viewedReturn, 0) / performers.length : null;
  const chart = useMemo(() => chartData(stocks, period), [stocks, period]);
  const breadth = performers.length ? Math.round(advancing / performers.length * 100) : 0;
  const heatmapStocks = useMemo(() => [...viewedStocks].sort((a, b) => {
    const weight = (stock) => stock.marketCap || (stock.price * stock.volume) || 0;
    return weight(b) - weight(a) || a.ticker.localeCompare(b.ticker);
  }), [viewedStocks]);
  const equityHeatmapStocks = useMemo(() => heatmapStocks.filter((stock) => stock.assetType === "Equity"), [heatmapStocks]);
  const etfHeatmapStocks = useMemo(() => heatmapStocks.filter((stock) => stock.assetType === "ETF"), [heatmapStocks]);
  const marketSessions = useMemo(() => {
    const markets = new Map();
    stocks.forEach((stock) => {
      if (!stock.market?.name) return;
      const current = markets.get(stock.market.name);
      const status = current === "open" || stock.market.status === "open" ? "open" : current === "closed" || stock.market.status === "closed" ? "closed" : "unknown";
      markets.set(stock.market.name, status);
    });
    return [...markets].map(([name, status]) => ({ name, status }));
  }, [stocks]);
  const marketText = !online || storage === "error" ? "Data offline" : storage === "loading" ? "Connecting" : marketSessions.length ? marketSessions.map(({ name, status }) => `${name} ${status}`).join(" · ") : "Data connected";
  const connectionTitle = `${marketText}${refreshing ? " · Refreshing" : ""}${lastUpdated ? ` · Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(lastUpdated)}` : storage === "cached" ? " · Local cache" : ""}`;
  const marketStatusClass = marketSessions.some(({ status }) => status === "open") ? "session-open" : "session-closed";
  const freshnessSeconds = lastUpdated ? Math.max(0, Math.floor((clock - lastUpdated.getTime()) / 1000)) : null;
  const freshness = freshnessSeconds === null ? "Awaiting first update" : freshnessSeconds < 5 ? "Updated just now" : freshnessSeconds < 60 ? `Updated ${freshnessSeconds}s ago` : `Updated ${Math.floor(freshnessSeconds / 60)}m ago`;

  const notify = (message) => { window.clearTimeout(noticeTimer.current); setNotice(message); noticeTimer.current = window.setTimeout(() => setNotice(""), 2600); };

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    const cacheKey = watchlistCacheKey(userKey);
    let hasUsableData = false;
    let activeController = null;
    let refreshInFlight = false;
    let intervalId = null;

    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey) || "null");
      if (cached?.version === WATCHLIST_CACHE_VERSION && Array.isArray(cached.stocks)) {
        hasUsableData = true;
        setStocks(cached.stocks);
        setStorage("cached");
        setLastUpdated(Number.isFinite(cached.savedAt) ? new Date(cached.savedAt) : null);
      }
    } catch {
      try { window.localStorage.removeItem(cacheKey); } catch {}
    }

    const refresh = async () => {
      if (refreshInFlight || document.visibilityState === "hidden") return;
      refreshInFlight = true;
      setRefreshing(true);
      activeController = new AbortController();
      const requestTimeout = window.setTimeout(() => activeController?.abort("timeout"), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/watchlist", { signal: activeController.signal, cache: "no-store" });
        const data = await response.json();
        if (response.status === 401) { window.location.replace("/login"); return; }
        if (!response.ok) throw new Error(data.error);
        const savedAt = Date.now();
        hasUsableData = true;
        setStocks(data);
        setStorage("connected");
        setLastUpdated(new Date(savedAt));
        cacheWatchlist(userKey, data);
      } catch (error) {
        if (error.name !== "AbortError" || activeController?.signal.reason === "timeout") {
          setStorage(hasUsableData ? "cached" : "error");
          if (!hasUsableData) notify(activeController?.signal.reason === "timeout" ? "Market data timed out. Try refreshing." : error.message || "Market data is unavailable");
        }
      } finally {
        window.clearTimeout(requestTimeout);
        refreshInFlight = false;
        setRefreshing(false);
      }
    };

    const handleVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    refreshNowRef.current = refresh;
    refresh();
    intervalId = window.setInterval(refresh, LIVE_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      activeController?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", refresh);
      refreshNowRef.current = null;
      window.clearTimeout(noticeTimer.current);
    };
  }, [userKey]);

  useEffect(() => {
    const updateConnection = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) refreshNowRef.current?.();
    };
    const clockId = window.setInterval(() => setClock(Date.now()), 1_000);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.clearInterval(clockId);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!modal) return undefined;
    const close = (event) => { if (event.key === "Escape" && !savingTicker) setModal(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [modal, savingTicker]);

  async function addTicker(event) {
    event.preventDefault();
    if (savingTicker) return;
    const clean = ticker.trim().toUpperCase();
    setSavingTicker(true);
    try {
      const response = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: clean }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStocks((current) => { const next = [data, ...current]; cacheWatchlist(userKey, next); return next; }); setTicker(""); setModal(false); notify(`${clean} added to Aperture`);
    } catch (error) { notify(error.message || "Could not add ticker"); }
    finally { setSavingTicker(false); }
  }

  async function removeTicker(value) {
    if (removingTicker) return;
    setRemovingTicker(value);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(value)}`, { method: "DELETE", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error();
      setStocks((current) => { const next = current.filter((stock) => stock.ticker !== value); cacheWatchlist(userKey, next); return next; }); notify(`${value} removed from Aperture`);
    } catch { notify("Could not remove ticker"); }
    finally { setRemovingTicker(""); }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => null);
    try { window.localStorage.removeItem(watchlistCacheKey(userKey)); } catch {}
    window.location.replace("/login");
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try { window.localStorage.setItem("aperture:theme", next); } catch {}
  }

  function exportWatchlist() {
    if (!stocks.length) { notify("Add a ticker before exporting"); return; }
    const exportedAt = new Date().toISOString();
    const records = stocks.map((stock) => ({
      schema: "aperture.watchlist.ticker.v1",
      exportedAt,
      source: "Yahoo Finance via Aperture",
      ticker: stock.ticker,
      company: stock.name,
      assetType: stock.assetType === "ETF" ? "ETF" : "Equity",
      sector: stock.sector,
      market: stock.market,
      quote: { priceUsd: stock.price, dailyChangePercent: stock.day, marketCap: stock.marketCap ?? null, volume: stock.volume ?? null, dataStatus: stock.marketDataStatus },
      analytics: {
        apertureSignal: stock.signal,
        fiftyTwoWeekPositionPercent: stock.range,
        returnsPercent: Object.fromEntries(Object.keys(periodBars).map((timeframe) => [timeframe, periodReturn(stock, timeframe)])),
      },
      history: {
        intraday5Minute: stock.intradayHistory || [],
        hourly6Month: stock.hourlyHistory || [],
        daily3Year: stock.history || [],
        monthlyMax: stock.maxHistory || [],
      },
    }));
    const contents = records.map((record) => JSON.stringify(record)).join("\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "application/x-ndjson;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aperture-watchlist-${exportedAt.slice(0, 10)}.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`${records.length} ticker${records.length === 1 ? "" : "s"} exported for ingestion`);
  }

  function sortTable(column) {
    if (sortBy === column) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortDirection(column === "company" ? "asc" : "desc"); }
  }

  const sortLabel = (column) => sortBy === column ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const stockRow = (stock) => <tr className="stock-row" key={stock.ticker}><td><Link className="company-cell company-link" href={`/focus?ticker=${encodeURIComponent(stock.ticker)}`}><span className="monogram">{stock.ticker.slice(0, 2)}</span><div><b>{stock.ticker}</b><small>{stock.name}</small></div></Link></td><td data-label="Last price">{money(stock.price)}</td><td data-label="Today"><span className={`return ${tone(stock.day)}`}>{percent(stock.day)}</span></td><td data-label={`${period} return`}><span className={`return ${tone(stock.viewedReturn)}`}>{percent(stock.viewedReturn)}</span></td><td data-label="52 week range"><div className="range"><i style={{ left: `${stock.range || 0}%` }}/></div></td><td data-label="Signal"><span className="signal-value">{Number.isFinite(stock.signal) ? stock.signal : "—"}</span><small className="of-100"> / 100</small></td><td className="row-action"><button className="remove" disabled={Boolean(removingTicker)} aria-label={removingTicker === stock.ticker ? `Removing ${stock.ticker}` : `Remove ${stock.ticker} from Aperture`} onClick={() => removeTicker(stock.ticker)}>{removingTicker === stock.ticker ? <span className="button-spinner dark" aria-hidden="true"/> : "×"}</button></td></tr>;

  return <div className="shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Aperture home"><span className="brand-mark"><ApertureMark /></span><span>Aperture</span></a>
      <nav className="header-center" aria-label="Primary navigation">{[["overview", "/", "Overview"], ["heatmap", "/heatmap", "Heat map"], ["focus", "/focus", "Focus"], ["watchlist", "/watchlist", "Watchlist"]].map(([key, href, label]) => <Link className={view === key ? "active" : ""} href={href} key={key}>{label}</Link>)}</nav>
      <div className="header-actions">
        <span className={`connection ${online ? storage : "error"} ${marketStatusClass} ${refreshing ? "refreshing" : ""}`} title={connectionTitle}><i />{marketText}</span>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}><ThemeIcon dark={theme === "dark"}/></button>
        <details className="account-menu">
          <summary aria-label="Open account menu"><span className="account-avatar">{(userName || userEmail || "A").slice(0, 1).toUpperCase()}</span><span className="account-summary-name">{userName || "Account"}</span><i/></summary>
          <div className="account-popover">
            <div className="account-profile"><span className="account-avatar large">{(userName || userEmail || "A").slice(0, 1).toUpperCase()}</span><div><strong>{userName || "Aperture investor"}</strong><small>{userEmail}</small></div></div>
            <div className="account-menu-actions">
              <button type="button" disabled={!stocks.length} onClick={(event) => { exportWatchlist(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ExportIcon/><span>Export JSONL</span></button>
              <button className="menu-signout" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? <span className="button-spinner dark" aria-hidden="true"/> : <span className="signout-glyph">↗</span>}<span>{signingOut ? "Signing out…" : "Sign out"}</span></button>
            </div>
          </div>
        </details>
        <button className="add-position-button" onClick={() => setModal(true)}><span>＋</span><strong>Add position</strong></button>
      </div>
    </header>

    <main id="top">
      {view === "overview" ? <section className="hero"><div className="hero-copy"><p className="kicker">Aperture / Market overview</p><h1>See the whole<br/>market picture.</h1><p className="hero-sub">A focused view of the companies that matter to you—performance, momentum, and signal in one frame.</p></div><div className="hero-meta"><span>{String(stocks.length).padStart(2, "0")}</span><p>Companies in focus<br/><b>{advancing} advancing today</b></p></div></section> : <section className="page-masthead"><p className="kicker">Aperture / {pageDetails[view][0]}</p><h1>{pageDetails[view][1]}</h1><p>{stocks.length} tracked positions · {advancing} advancing</p></section>}
      <section className="control-row" aria-label="Dashboard controls"><div className="periods"><span>Timeframe</span>{Object.keys(periodBars).map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value}</button>)}</div><div className="live-controls"><span>{freshness}</span><i>·</i><span>{periodResolution[period]} resolution</span><button type="button" disabled={refreshing || !online} onClick={() => refreshNowRef.current?.()} aria-label={refreshing ? "Refreshing market data" : "Refresh market data now"}>{refreshing ? <span className="button-spinner dark" aria-hidden="true"/> : "↻"} Refresh</button></div></section>
      {storage !== "loading" && view === "overview" && <section className="overview-grid">
        <article className="performance-panel"><div className="panel-top"><div><p className="label">Aggregate performance</p><h2 className={tone(watchlistReturn)}>{percent(watchlistReturn)}</h2><p>Across your Aperture watchlist · {period}</p></div><span className={`trend-badge ${tone(chart?.current)}`}><ArrowIcon /> {percent(chart?.current)}</span></div><div className="chart-wrap"><div className="chart-grid"><span>High</span><span>Avg</span><span>Low</span></div>{chart ? <TimelineChart data={chart} fillId="chartFill" label={`Watchlist performance over ${period}`}/> : <div className="chart-empty">Market history will appear here</div>}<div className="chart-axis"><span>Open</span><span>Midpoint</span><span>Latest</span></div></div></article>
        <aside className="stats-panel"><article><p className="label">Market breadth</p><div className="stat-line"><strong>{breadth}%</strong><span className="positive">{advancing} of {performers.length}</span></div><div className="breadth-bar"><i style={{ width: `${breadth}%` }}/></div><p>of tracked names are advancing</p></article><article><p className="label">Leading position</p>{performers[0] ? <Link className="leader ticker-link" href={`/focus?ticker=${encodeURIComponent(performers[0].ticker)}`}><span className="monogram">{performers[0].ticker.slice(0, 2)}</span><div><strong>{performers[0].ticker}</strong><p>{performers[0].name}</p></div><b className={tone(performers[0].viewedReturn)}>{percent(performers[0].viewedReturn)}</b></Link> : <div className="leader"><span className="monogram">—</span><div><strong>No data</strong><p>Awaiting market feed</p></div><b>—</b></div>}</article><article><p className="label">Aperture signal</p><div className="signal-summary"><strong>{Math.round(performers.reduce((sum, stock) => sum + (stock.signal || 0), 0) / (performers.length || 1))}</strong><span>/ 100<br/><b>Aggregate momentum</b></span></div></article></aside>
      </section>}

      {storage !== "loading" && view === "heatmap" && <section className="heatmap-section route-section">
        <div className="section-title heatmap-title"><div><p className="kicker">Market field</p><h2>Performance field</h2></div><div className="heat-legend" aria-label="Continuous heat map scale"><span>Decline</span><i/><span>Advance</span></div></div>
        <div className="heatmap-groups">
          <section className="heatmap-group" aria-labelledby="equity-map-title"><header><div><span>01</span><h3 id="equity-map-title">Equities</h3></div><small>{equityHeatmapStocks.length} ticker{equityHeatmapStocks.length === 1 ? "" : "s"}</small></header>{equityHeatmapStocks.length ? <PerformanceTreemap stocks={equityHeatmapStocks} period={period} theme={theme} groupLabel="equity"/> : <div className="heatmap-empty compact"><span>◉</span><p>Add an equity to build this market field.</p></div>}</section>
          <section className="heatmap-group" aria-labelledby="etf-map-title"><header><div><span>02</span><h3 id="etf-map-title">Exchange-traded funds</h3></div><small>{etfHeatmapStocks.length} ticker{etfHeatmapStocks.length === 1 ? "" : "s"}</small></header>{etfHeatmapStocks.length ? <PerformanceTreemap stocks={etfHeatmapStocks} period={period} theme={theme} groupLabel="ETF"/> : <div className="heatmap-empty compact"><span>◉</span><p>Add an ETF to build this market field.</p></div>}</section>
        </div>
        <p className="heatmap-note">{viewedStocks.length} watchlist tickers · Color reflects {period} movement · Size reflects market weight within each asset class</p>
      </section>}

      {storage !== "loading" && view === "focus" && <section className="focus-section route-section">
        <div className="focus-toolbar"><div><p className="kicker">Single-security view</p><h2>{focusedStock?.name || "Choose a position"}</h2></div><label className="ticker-selector"><span>Position</span><select value={focusedStock?.ticker || ""} onChange={(event) => { const value = event.target.value; setFocusedTicker(value); router.replace(`/focus?ticker=${encodeURIComponent(value)}`, { scroll: false }); }} aria-label="Choose a ticker to focus">{[...viewedStocks].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((stock) => <option value={stock.ticker} key={stock.ticker}>{stock.ticker} — {stock.name}</option>)}</select></label></div>
        {focusedStock ? <div className="focus-workspace">
          <article className="focus-primary"><div className="focus-identity"><span className="focus-monogram">{focusedStock.ticker.slice(0, 2)}</span><div><span>{focusedStock.assetType} · {focusedStock.sector}</span><h3>{focusedStock.ticker}</h3></div><strong>{money(focusedStock.price)}</strong></div><div className="focus-return"><span>{period} return</span><b className={tone(focusedStock.viewedReturn)}>{percent(focusedStock.viewedReturn)}</b></div><div className="focus-chart"><div className="chart-grid"><span>High</span><span>Avg</span><span>Low</span></div>{focusedChart ? <TimelineChart data={focusedChart} fillId="focusFill" label={`${focusedStock.ticker} performance over ${period}`}/> : <div className="chart-empty">Price history is unavailable</div>}</div></article>
          <aside className="focus-metrics"><article><span>Today</span><strong className={tone(focusedStock.day)}>{percent(focusedStock.day)}</strong><p>Latest market session</p></article><article><span>Aperture signal</span><strong>{Number.isFinite(focusedStock.signal) ? focusedStock.signal : "—"}<small> / 100</small></strong><p>Price momentum score</p></article><article><span>52 week position</span><strong>{Number.isFinite(focusedStock.range) ? `${Math.round(focusedStock.range)}%` : "—"}</strong><div className="focus-range"><i style={{ left: `${focusedStock.range || 0}%` }}/></div></article><article><span>Market</span><strong className={focusedStock.market?.status === "open" ? "positive" : "neutral"}>{focusedStock.market ? `${focusedStock.market.name} ${focusedStock.market.status}` : "Unavailable"}</strong><p>Regular trading session</p></article></aside>
        </div> : <div className="focus-empty">Add a ticker to create a focused view.</div>}
      </section>}

      {storage !== "loading" && view === "watchlist" && <section className="watchlist-section route-section">
        <div className="section-title watchlist-title"><div><p className="kicker">Your universe</p><h2>Aperture watchlist</h2></div><label className="search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search Aperture watchlist" placeholder="Search company or ticker"/></label></div>
        <div className="table-controls">
          <div className="asset-filters" aria-label="Filter by asset class">{[["all", "All assets"], ["Equity", "Equities"], ["ETF", "ETFs"]].map(([value, label]) => <button key={value} className={assetClass === value ? "active" : ""} onClick={() => setAssetClass(value)}>{label}</button>)}</div>
          <div className="movement-filters" aria-label="Filter by performance">{[["all", "All positions"], ["advancing", "Advancing"], ["declining", "Declining"]].map(([value, label]) => <button key={value} className={movement === value ? "active" : ""} onClick={() => setMovement(value)}>{label}</button>)}</div>
          <label className="sector-filter"><span>Sector</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">All sectors</option>{sectors.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <span className="result-count">{shown.length} of {stocks.length} positions</span>
        </div>
        <div className="table-wrap"><table><thead><tr>
          <th><button className={sortBy === "company" ? "active" : ""} onClick={() => sortTable("company")}>Company <span>{sortLabel("company")}</span></button></th>
          <th><button className={sortBy === "price" ? "active" : ""} onClick={() => sortTable("price")}>Last price <span>{sortLabel("price")}</span></button></th>
          <th><button className={sortBy === "day" ? "active" : ""} onClick={() => sortTable("day")}>Today <span>{sortLabel("day")}</span></button></th>
          <th><button className={sortBy === "viewedReturn" ? "active" : ""} onClick={() => sortTable("viewedReturn")}>{period} return <span>{sortLabel("viewedReturn")}</span></button></th>
          <th><button className={sortBy === "range" ? "active" : ""} onClick={() => sortTable("range")}>52 week range <span>{sortLabel("range")}</span></button></th>
          <th><button className={sortBy === "signal" ? "active" : ""} onClick={() => sortTable("signal")}>Signal <span>{sortLabel("signal")}</span></button></th>
          <th><span className="sr-only">Actions</span></th>
        </tr></thead>{[["Equity", "Equities"], ["ETF", "Exchange-traded funds"]].map(([type, label]) => { const group = shown.filter((stock) => stock.assetType === type); return group.length > 0 && <tbody key={type}><tr className="asset-group-row"><td colSpan="7"><span>{label}</span><b>{group.length}</b></td></tr>{group.map(stockRow)}</tbody>; })}</table>{shown.length === 0 && <div className="empty-state"><strong>No positions found</strong><p>Adjust your search or filters to see more of your watchlist.</p><button onClick={() => { setQuery(""); setMovement("all"); setAssetClass("all"); setSector("all"); }}>Clear filters</button></div>}</div>
      </section>}
    </main>

    <footer><div className="brand footer-brand"><span className="brand-mark"><ApertureMark /></span><span>Aperture</span></div><p>Clarity for considered investors.</p><span>Market data via Yahoo Finance · Informational only</span></footer>
    {modal && <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingTicker) setModal(false); }}><form className="dialog" onSubmit={addTicker} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-busy={savingTicker}><button className="dialog-close" type="button" disabled={savingTicker} onClick={() => setModal(false)} aria-label="Close">×</button><span className="dialog-mark"><ApertureMark /></span><p className="kicker">Expand your view</p><h2 id="dialog-title">Add to Aperture</h2><p>Enter a market ticker to bring the company into your watchlist.</p><label>Ticker symbol<input autoFocus value={ticker} disabled={savingTicker} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength="12" placeholder="e.g. AAPL" required/></label><div className="dialog-actions"><button className="secondary-button" type="button" disabled={savingTicker} onClick={() => setModal(false)}>Cancel</button><button className="primary-button" disabled={savingTicker} type="submit">{savingTicker && <span className="button-spinner" aria-hidden="true"/>}{savingTicker ? "Adding…" : "Add position"}</button></div></form></div>}
    <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
  </div>;
}
