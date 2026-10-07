"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

const PerformanceTreemap = dynamic(() => import("./performance-treemap"), {
  loading: () => <div className="performance-treemap" aria-label="Loading performance heat map" />,
});

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
const WATCHLIST_CACHE_VERSION = 3;
const LIVE_REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const benchmarks = { "^GSPC": "S&P 500", "^NDX": "Nasdaq 100" };
const sessionHours = { US: 6.5, Canada: 6.5, India: 6.25, UK: 8.5, Japan: 6, "Hong Kong": 5.5, China: 4, Australia: 6 };

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

function periodReturn(stock, period) {
  return Number.isFinite(stock.returns?.[period]) ? stock.returns[period] : null;
}

function chartData(stocks, period) {
  const series = stocks.map((stock) => stock.periodHistory || []).filter((history) => history.length > 1);
  const available = Math.max(0, ...series.map((history) => history.length));
  const length = available;
  if (length < 2) return null;
  const values = Array.from({ length }, (_, index) => {
    const returns = series.flatMap((history) => {
      const base = history[0]?.close;
      const alignedIndex = history.length > 1 ? Math.round((index / (length - 1)) * (history.length - 1)) : 0;
      const close = history[alignedIndex]?.close;
      return base && close ? [(close / base - 1) * 100] : [];
    });
    return returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  });
  const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const reference = [...series].sort((a, b) => b.length - a.length)[0] || [];
  const firstTime = new Date(reference[0]?.date).getTime();
  const lastTime = new Date(reference.at(-1)?.date).getTime();
  const market = stocks.find((stock) => stock.market?.name)?.market?.name;
  const fullSessionMs = (sessionHours[market] || 6.5) * 60 * 60_000;
  const intradaySpan = Number.isFinite(firstTime) && Number.isFinite(lastTime) ? Math.min(fullSessionMs, Math.max(0, lastTime - firstTime)) : fullSessionMs;
  const samples = values.map((value, index) => {
    const date = reference[index]?.date;
    const time = new Date(date).getTime();
    const elapsed = Number.isFinite(time) && Number.isFinite(firstTime) ? Math.max(0, time - firstTime) : (index / (values.length - 1)) * intradaySpan;
    const x = period === "1D" ? Math.min(600, (elapsed / fullSessionMs) * 600) : (index / (values.length - 1)) * 600;
    return { value, date, x, y: 180 - ((value - min) / spread) * 140 };
  });
  const points = samples.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaEnd = samples.at(-1).x;
  return { points, area: `0,220 ${points} ${areaEnd},220`, current: values.at(-1), samples, showTime: periodBars[period].source === "intradayHistory" || periodBars[period].source === "hourlyHistory" };
}

function comparisonData(primaryHistory = [], benchmarkHistory = []) {
  const toReturns = (history) => {
    const base = history[0]?.close;
    return base ? history.map((bar) => ({ date: bar.date, value: (bar.close / base - 1) * 100 })) : [];
  };
  const primary = toReturns(primaryHistory), benchmark = toReturns(benchmarkHistory);
  if (primary.length < 2 || benchmark.length < 2) return null;
  const values = [...primary, ...benchmark].map(({ value }) => value);
  const min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const points = (series) => series.map(({ value }, index) => `${(index / (series.length - 1)) * 600},${180 - ((value - min) / spread) * 140}`).join(" ");
  return { primary: points(primary), benchmark: points(benchmark), primaryReturn: primary.at(-1).value, benchmarkReturn: benchmark.at(-1).value };
}

function signalBreakdown(stock) {
  const day = Number.isFinite(stock?.day) ? stock.day : 0;
  const month = Number.isFinite(stock?.month) ? stock.month : 0;
  return [
    { label: "Base score", value: 50, note: "Neutral starting point" },
    { label: "1 month momentum", value: month * 1.5, note: `${percent(month)} × 1.5` },
    { label: "Session momentum", value: day * 2, note: `${percent(day)} × 2` },
  ];
}

function alertMatches(alert, stock) {
  if (!stock || !Number.isFinite(alert.threshold)) return false;
  if (alert.condition === "above") return Number.isFinite(stock.price) && stock.price >= alert.threshold;
  if (alert.condition === "below") return Number.isFinite(stock.price) && stock.price <= alert.threshold;
  return Number.isFinite(stock.day) && Math.abs(stock.day) >= alert.threshold;
}

function Freshness({ lastUpdated }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clockId = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(clockId);
  }, []);
  const seconds = lastUpdated ? Math.max(0, Math.floor((now - lastUpdated.getTime()) / 1000)) : null;
  const label = seconds === null ? "Awaiting first update" : seconds < 5 ? "Updated just now" : seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`;
  return <span>{label}</span>;
}

function TimelineChart({ data, fillId, label }) {
  const [hover, setHover] = useState(null);
  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const pointerX = ratio * 600;
    const index = data.samples.reduce((closest, sample, sampleIndex) => Math.abs(sample.x - pointerX) < Math.abs(data.samples[closest].x - pointerX) ? sampleIndex : closest, 0);
    const sample = data.samples[index];
    const parentRect = event.currentTarget.parentElement.getBoundingClientRect();
    setHover({ ...sample, index, left: rect.left - parentRect.left + (sample.x / 600) * rect.width, top: rect.top - parentRect.top + (sample.y / 220) * rect.height });
  };
  const date = hover?.date ? new Intl.DateTimeFormat("en-US", data.showTime ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(hover.date)) : "Date unavailable";
  return <><svg className="main-chart interactive-chart" viewBox="0 0 600 220" preserveAspectRatio="none" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)}><defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d7a57" stopOpacity=".22"/><stop offset="1" stopColor="#1d7a57" stopOpacity="0"/></linearGradient></defs><polygon points={data.area} fill={`url(#${fillId})`}/><polyline points={data.points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>{hover && <line x1={hover.x} x2={hover.x} y1="12" y2="205" className="hover-line" vectorEffect="non-scaling-stroke"/>}</svg>{hover && <><i className="chart-hover-dot" style={{ left: hover.left, top: hover.top }}/><div className={`chart-tooltip ${hover.index < 2 ? "edge-left" : hover.index > data.samples.length - 3 ? "edge-right" : ""}`} style={{ left: hover.left, top: hover.top }}><span>{date}</span><strong className={tone(hover.value)}>{percent(hover.value)}</strong></div></>}</>;
}

function ComparisonChart({ data, label, benchmarkName }) {
  return <svg className="main-chart comparison-chart" viewBox="0 0 600 220" preserveAspectRatio="none" role="img" aria-label={`${label}; solid line is the position and dashed line is ${benchmarkName}`}>
    <polyline points={data.benchmark} fill="none" className="benchmark-line" vectorEffect="non-scaling-stroke"/>
    <polyline points={data.primary} fill="none" className="position-line" vectorEffect="non-scaling-stroke"/>
  </svg>;
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
  const [tickerPreview, setTickerPreview] = useState({ status: "idle" });
  const [savingTicker, setSavingTicker] = useState(false), [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [lastUpdated, setLastUpdated] = useState(null);
  const [online, setOnline] = useState(true);
  const [histories, setHistories] = useState({});
  const [theme, setTheme] = useState("light");
  const [benchmarkTicker, setBenchmarkTicker] = useState("^GSPC"), [benchmark, setBenchmark] = useState(null);
  const [alerts, setAlerts] = useState([]), [alertsLoading, setAlertsLoading] = useState(true);
  const [timedAlerts, setTimedAlerts] = useState([]);
  const [alertCondition, setAlertCondition] = useState("above"), [alertThreshold, setAlertThreshold] = useState("");
  const [signalOpen, setSignalOpen] = useState(false);
  const [expandedHeatmaps, setExpandedHeatmaps] = useState({ equities: true });
  const [movement, setMovement] = useState("all"), [assetClass, setAssetClass] = useState("all"), [sector, setSector] = useState("all"), [sortBy, setSortBy] = useState("viewedReturn"), [sortDirection, setSortDirection] = useState("desc");
  const noticeTimer = useRef(null);
  const refreshNowRef = useRef(null);
  const refreshHistoryRef = useRef(null);
  const pendingRemovals = useRef(new Set());
  const tickerKey = useMemo(() => stocks.map((stock) => stock.ticker).sort().join(","), [stocks]);
  const viewedStocks = useMemo(() => stocks.map((stock) => ({ ...stock, assetType: stock.assetType === "ETF" ? "ETF" : "Equity", viewedReturn: periodReturn(stock, period), periodHistory: histories[stock.ticker] || [] })), [stocks, period, histories]);
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
  const focusComparison = useMemo(() => comparisonData(focusedStock?.periodHistory, benchmark?.history), [focusedStock, benchmark]);
  const advancing = performers.filter((stock) => stock.viewedReturn >= 0).length;
  const watchlistReturn = performers.length ? performers.reduce((sum, stock) => sum + stock.viewedReturn, 0) / performers.length : null;
  const chart = useMemo(() => chartData(viewedStocks, period), [viewedStocks, period]);
  const breadth = performers.length ? Math.round(advancing / performers.length * 100) : 0;
  const heatmapStocks = useMemo(() => [...viewedStocks].sort((a, b) => {
    const weight = (stock) => stock.marketCap || (stock.price * stock.volume) || 0;
    return weight(b) - weight(a) || a.ticker.localeCompare(b.ticker);
  }), [viewedStocks]);
  const equityHeatmapStocks = useMemo(() => heatmapStocks.filter((stock) => stock.assetType === "Equity"), [heatmapStocks]);
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
  const triggeredAlerts = useMemo(() => alerts.flatMap((alert) => {
    const stock = stocks.find((item) => item.ticker === alert.ticker);
    return alertMatches(alert, stock) ? [{ ...alert, stock }] : [];
  }), [alerts, stocks]);
  const briefingMovers = useMemo(() => [...stocks].filter((stock) => Number.isFinite(stock.day)).sort((a, b) => Math.abs(b.day) - Math.abs(a.day)).slice(0, 3), [stocks]);

  const notify = (message) => { window.clearTimeout(noticeTimer.current); setNotice(message); noticeTimer.current = window.setTimeout(() => setNotice(""), 2600); };
  const toggleHeatmap = (key) => setExpandedHeatmaps((current) => ({ ...current, [key]: !current[key] }));

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const storageKey = `aperture:alerts:${userKey}`;
    async function loadAlerts() {
      setAlertsLoading(true);
      try {
        let savedAlerts = [];
        try {
          const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
          savedAlerts = Array.isArray(parsed) ? parsed : [];
        } catch {}
        if (savedAlerts.length) {
          await Promise.all(savedAlerts.map(async ({ ticker: savedTicker, condition, threshold }) => {
            const response = await fetch("/api/alerts", {
              method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
              body: JSON.stringify({ ticker: savedTicker, condition, threshold }),
            });
            if (!response.ok) throw new Error("Could not migrate browser alerts.");
          }));
          try { window.localStorage.removeItem(storageKey); } catch {}
        }
        const response = await fetch("/api/alerts", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setAlerts(data);
      } catch (error) {
        if (error.name !== "AbortError") notify(error.message || "Alerts are unavailable");
      } finally {
        if (!controller.signal.aborted) setAlertsLoading(false);
      }
    }
    loadAlerts();
    return () => controller.abort();
  }, [userKey]);

  useEffect(() => {
    if (storage === "loading" || alertsLoading) return;
    const key = `aperture:triggered-alerts:${userKey}`;
    const triggeredIds = triggeredAlerts.map((alert) => alert.id);
    let previouslyTriggered = [];
    try { previouslyTriggered = JSON.parse(window.sessionStorage.getItem(key) || "[]"); } catch {}
    const previous = new Set(Array.isArray(previouslyTriggered) ? previouslyTriggered : []);
    const newlyTriggered = triggeredAlerts.filter((alert) => !previous.has(alert.id));
    if (newlyTriggered.length) {
      setTimedAlerts((current) => {
        const queued = new Set(current.map((alert) => alert.id));
        return [...current, ...newlyTriggered.filter((alert) => !queued.has(alert.id))];
      });
    }
    try { window.sessionStorage.setItem(key, JSON.stringify(triggeredIds)); } catch {}
  }, [triggeredAlerts, storage, alertsLoading, userKey]);

  useEffect(() => {
    if (!timedAlerts.length) return;
    const timer = window.setTimeout(() => setTimedAlerts((current) => current.slice(1)), 7000);
    return () => window.clearTimeout(timer);
  }, [timedAlerts]);

  useEffect(() => {
    const controller = new AbortController();
    setBenchmark(null);
    fetch(`/api/benchmark?ticker=${encodeURIComponent(benchmarkTicker)}&period=${encodeURIComponent(period)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(setBenchmark)
      .catch((error) => { if (error.name !== "AbortError") notify(error.message || "Benchmark is unavailable"); });
    return () => controller.abort();
  }, [benchmarkTicker, period]);

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
        setStocks(cached.stocks.filter((stock) => !stock._optimistic));
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
        setStocks((current) => {
          const optimistic = current.filter((stock) => stock._optimistic && !data.some((item) => item.ticker === stock.ticker));
          const next = [...optimistic, ...data.filter((stock) => !pendingRemovals.current.has(stock.ticker))];
          cacheWatchlist(userKey, next.filter((stock) => !stock._optimistic));
          return next;
        });
        setStorage("connected");
        setLastUpdated(new Date(savedAt));
        refreshHistoryRef.current?.();
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
    if (!tickerKey) { setHistories({}); return undefined; }
    const controller = new AbortController();
    setHistories({});
    const refreshHistory = async () => {
      try {
        const response = await fetch(`/api/watchlist/history?period=${encodeURIComponent(period)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setHistories(Object.fromEntries(data.map((item) => [item.ticker, item.history])));
      } catch (error) {
        if (error.name !== "AbortError") notify(error.message || "Price history is unavailable");
      }
    };
    refreshHistoryRef.current = refreshHistory;
    refreshHistory();
    return () => {
      controller.abort();
      if (refreshHistoryRef.current === refreshHistory) refreshHistoryRef.current = null;
    };
  }, [period, tickerKey]);

  useEffect(() => {
    const updateConnection = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) refreshNowRef.current?.();
    };
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
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

  useEffect(() => {
    if (!modal) {
      setTickerPreview({ status: "idle" });
      return undefined;
    }
    const clean = ticker.trim().toUpperCase();
    if (!clean) {
      setTickerPreview({ status: "idle" });
      return undefined;
    }
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(clean)) {
      setTickerPreview({ status: "error", message: "Enter a valid Yahoo Finance ticker." });
      return undefined;
    }
    if (stocks.some((stock) => stock.ticker === clean)) {
      setTickerPreview({ status: "error", message: `${clean} is already in your watchlist.` });
      return undefined;
    }

    const controller = new AbortController();
    setTickerPreview({ status: "loading", ticker: clean });
    const lookupTimer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/market-data/lookup?ticker=${encodeURIComponent(clean)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.status === 401) { window.location.replace("/login"); return; }
        if (!response.ok) throw new Error(data.error);
        setTickerPreview({ status: "success", ...data });
      } catch (error) {
        if (error.name !== "AbortError") setTickerPreview({ status: "error", message: error.message || "Could not identify this ticker." });
      }
    }, 350);
    return () => {
      window.clearTimeout(lookupTimer);
      controller.abort();
    };
  }, [modal, ticker, stocks]);

  async function addTicker(event) {
    event.preventDefault();
    if (savingTicker) return;
    const clean = ticker.trim().toUpperCase();
    if (stocks.some((stock) => stock.ticker === clean)) { notify(`${clean} is already tracked`); return; }
    if (tickerPreview.status !== "success" || tickerPreview.ticker !== clean) return;
    const optimisticStock = {
      ticker: clean,
      name: `${clean} · Adding…`,
      sector: "Pending market data",
      assetType: "Equity",
      market: null,
      returns: {},
      marketDataStatus: "pending",
      _optimistic: true,
    };
    setSavingTicker(true);
    setStocks((current) => [optimisticStock, ...current]);
    setModal(false);
    try {
      const response = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: clean }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStocks((current) => {
        const next = current.some((stock) => stock.ticker === clean)
          ? current.map((stock) => stock.ticker === clean ? data : stock)
          : [data, ...current];
        cacheWatchlist(userKey, next);
        return next;
      });
      setTicker("");
      refreshHistoryRef.current?.();
      notify(`${clean} added to Aperture`);
    } catch (error) {
      setStocks((current) => {
        const next = current.filter((stock) => stock.ticker !== clean || !stock._optimistic);
        cacheWatchlist(userKey, next);
        return next;
      });
      setModal(true);
      notify(error.message || "Could not add ticker");
    }
    finally { setSavingTicker(false); }
  }

  async function removeTicker(value) {
    if (pendingRemovals.current.has(value)) return;
    const removedIndex = stocks.findIndex((stock) => stock.ticker === value);
    const removedStock = stocks[removedIndex];
    if (!removedStock || removedStock._optimistic) return;
    pendingRemovals.current.add(value);
    setStocks((current) => {
      const next = current.filter((stock) => stock.ticker !== value);
      cacheWatchlist(userKey, next);
      return next;
    });
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(value)}`, { method: "DELETE", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error();
      notify(`${value} removed from Aperture`);
    } catch {
      setStocks((current) => {
        if (current.some((stock) => stock.ticker === value)) return current;
        const next = [...current];
        next.splice(Math.min(removedIndex, next.length), 0, removedStock);
        cacheWatchlist(userKey, next);
        return next;
      });
      notify(`Could not remove ${value}; it was restored`);
    } finally {
      pendingRemovals.current.delete(value);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => null);
    try {
      window.localStorage.removeItem(watchlistCacheKey(userKey));
      window.sessionStorage.removeItem(`aperture:triggered-alerts:${userKey}`);
    } catch {}
    window.location.replace("/login");
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try { window.localStorage.setItem("aperture:theme", next); } catch {}
  }

  async function exportWatchlist() {
    if (!stocks.length) { notify("Add a ticker before exporting"); return; }
    const exportedAt = new Date().toISOString();
    let exportedHistories;
    try {
      const entries = await Promise.all(Object.keys(periodBars).map(async (timeframe) => {
        const response = await fetch(`/api/watchlist/history?period=${encodeURIComponent(timeframe)}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        return [timeframe, await response.json()];
      }));
      exportedHistories = Object.fromEntries(entries);
    } catch {
      notify("Could not prepare the export");
      return;
    }
    const records = stocks.map((stock) => ({
      schema: "aperture.watchlist.ticker.v1",
      exportedAt,
      source: `${stock.dataProvider || "Market data provider"} via Aperture`,
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
        periods: Object.fromEntries(Object.entries(exportedHistories).map(([timeframe, items]) => [timeframe, items.find((item) => item.ticker === stock.ticker)?.history || []])),
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

  async function addAlert(event) {
    event.preventDefault();
    const threshold = Number(alertThreshold);
    if (!focusedStock || !Number.isFinite(threshold) || threshold <= 0) return;
    setAlertsLoading(true);
    try {
      const response = await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: focusedStock.ticker, condition: alertCondition, threshold }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAlerts((current) => [data, ...current.filter((alert) => alert.id !== data.id)]);
      setAlertThreshold("");
      notify(`Alert created for ${focusedStock.ticker}`);
    } catch (error) {
      notify(error.message || "Could not create alert");
    } finally { setAlertsLoading(false); }
  }

  async function deleteAlert(alert) {
    setAlertsLoading(true);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alert.id)}`, { method: "DELETE", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
      notify(`Alert removed for ${alert.ticker}`);
    } catch (error) {
      notify(error.message || "Could not remove alert");
    } finally { setAlertsLoading(false); }
  }

  function describeAlert(alert) {
    if (alert.condition === "above") return `Price reaches ${money(alert.threshold)}`;
    if (alert.condition === "below") return `Price falls to ${money(alert.threshold)}`;
    return `Daily move reaches ±${alert.threshold.toFixed(1)}%`;
  }

  function sortTable(column) {
    if (sortBy === column) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortDirection(column === "company" ? "asc" : "desc"); }
  }

  const sortLabel = (column) => sortBy === column ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
  const stockRow = (stock) => <tr className={`stock-row ${stock._optimistic ? "optimistic" : ""}`} key={stock.ticker}><td><Link className="company-cell company-link" href={`/focus?ticker=${encodeURIComponent(stock.ticker)}`} aria-disabled={stock._optimistic} tabIndex={stock._optimistic ? -1 : undefined} onClick={(event) => { if (stock._optimistic) event.preventDefault(); }}><span className="monogram">{stock.ticker.slice(0, 2)}</span><div><b>{stock.ticker}</b><small>{stock.name}</small></div></Link></td><td data-label="Sector">{stock.sector || "—"}</td><td data-label="Last price">{money(stock.price)}</td><td data-label="Today"><span className={`return ${tone(stock.day)}`}>{percent(stock.day)}</span></td><td data-label={`${period} return`}><span className={`return ${tone(stock.viewedReturn)}`}>{percent(stock.viewedReturn)}</span></td><td data-label="52 week range"><div className="range"><i style={{ left: `${stock.range || 0}%` }}/></div></td><td data-label="Signal"><span className="signal-value">{Number.isFinite(stock.signal) ? stock.signal : "—"}</span><small className="of-100"> / 100</small></td><td className="row-action"><button className="remove" disabled={stock._optimistic} aria-label={stock._optimistic ? `Adding ${stock.ticker}` : `Remove ${stock.ticker} from Aperture`} onClick={() => removeTicker(stock.ticker)}>{stock._optimistic ? <span className="button-spinner dark" aria-hidden="true"/> : "×"}</button></td></tr>;

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
      {storage !== "loading" && (view === "heatmap" || view === "watchlist") && <section className="route-kpis" aria-label={`${pageDetails[view][0]} key metrics`}>
        <article><span>Tracked</span><strong>{stocks.length}</strong><p>positions in your universe</p></article>
        <article><span>Advancing</span><strong className="positive">{breadth}%</strong><p>{advancing} of {performers.length} with data</p></article>
        <article><span>{period} average</span><strong className={tone(watchlistReturn)}>{percent(watchlistReturn)}</strong><p>equal-weighted return</p></article>
        <article><span>Active alerts</span><strong>{alerts.length}</strong><p>{triggeredAlerts.length ? `${triggeredAlerts.length} triggered now` : "no thresholds reached"}</p></article>
      </section>}
      <section className="control-row" aria-label="Dashboard controls"><div className="periods"><span>Timeframe</span>{Object.keys(periodBars).map((value) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value}</button>)}</div><div className="live-controls"><Freshness lastUpdated={lastUpdated}/><i>·</i><span>{periodResolution[period]} resolution</span><button type="button" disabled={refreshing || !online} onClick={() => { refreshNowRef.current?.(); refreshHistoryRef.current?.(); }} aria-label={refreshing ? "Refreshing market data" : "Refresh market data now"}>{refreshing ? <span className="button-spinner dark" aria-hidden="true"/> : "↻"} Refresh</button></div></section>
      {storage !== "loading" && view === "overview" && stocks.length === 0 && <section className="onboarding-panel"><div><p className="kicker">Your first frame</p><h2>Start with the market you know.</h2><p>Add a company, fund, or index ticker. Aperture will build the performance view, signal, briefing, and Focus workspace around it.</p><button className="primary-button" onClick={() => setModal(true)}>＋ Add your first position</button></div><ol><li><span>01</span><div><strong>Add a ticker</strong><p>Search any Yahoo Finance symbol.</p></div></li><li><span>02</span><div><strong>Choose a benchmark</strong><p>Measure performance in context.</p></div></li><li><span>03</span><div><strong>Create an alert</strong><p>Return when a threshold matters.</p></div></li></ol></section>}
      {storage !== "loading" && view === "overview" && <section className="overview-grid">
        <article className="performance-panel"><div className="panel-top"><div><p className="label">Equal-weighted watchlist</p><h2 className={tone(watchlistReturn)}>{percent(watchlistReturn)}</h2><p>Average return across tracked positions · {period}</p></div><div className="benchmark-summary"><label>Benchmark<select value={benchmarkTicker} onChange={(event) => setBenchmarkTicker(event.target.value)}>{Object.entries(benchmarks).map(([tickerValue, name]) => <option key={tickerValue} value={tickerValue}>{name}</option>)}</select></label><strong className={tone(benchmark?.returns?.[period])}>{percent(benchmark?.returns?.[period])}</strong><small>{Number.isFinite(watchlistReturn) && Number.isFinite(benchmark?.returns?.[period]) ? `${watchlistReturn - benchmark.returns[period] >= 0 ? "+" : ""}${(watchlistReturn - benchmark.returns[period]).toFixed(2)}% relative` : "Comparing…"}</small></div></div><div className="chart-wrap"><div className="chart-grid"><span>High</span><span>Avg</span><span>Low</span></div>{chart ? <TimelineChart data={chart} fillId="chartFill" label={`Watchlist performance over ${period}`}/> : <div className="chart-empty">Add a position to begin the performance view</div>}<div className="chart-axis"><span>Open</span><span>Midpoint</span><span>Latest</span></div></div></article>
        <aside className="stats-panel"><article><p className="label">Market breadth</p><div className="stat-line"><strong>{breadth}%</strong><span className="positive">{advancing} of {performers.length}</span></div><div className="breadth-bar"><i style={{ width: `${breadth}%` }}/></div><p>of tracked names are advancing</p></article><article><p className="label">Leading position</p>{performers[0] ? <Link className="leader ticker-link" href={`/focus?ticker=${encodeURIComponent(performers[0].ticker)}`}><span className="monogram">{performers[0].ticker.slice(0, 2)}</span><div><strong>{performers[0].ticker}</strong><p>{performers[0].name}</p></div><b className={tone(performers[0].viewedReturn)}>{percent(performers[0].viewedReturn)}</b></Link> : <div className="leader"><span className="monogram">—</span><div><strong>No data</strong><p>Add your first position</p></div><b>—</b></div>}</article><article><div className="label-row"><p className="label">Aperture signal</p><button type="button" onClick={() => setSignalOpen((current) => !current)} aria-expanded={signalOpen}>How it works</button></div><div className="signal-summary"><strong>{performers.length ? Math.round(performers.reduce((sum, stock) => sum + (stock.signal || 0), 0) / performers.length) : "—"}</strong><span>/ 100<br/><b>Aggregate momentum</b></span></div>{signalOpen && <div className="signal-explainer"><p>Each position starts at 50. Aperture adds 1.5 points per percentage point of one-month return and 2 points per percentage point of today’s move, then caps the score from 0 to 100.</p><small>Momentum indicator only—not a recommendation.</small></div>}</article></aside>
      </section>}
      {storage !== "loading" && view === "overview" && stocks.length > 0 && <section className="briefing-section"><div className="briefing-heading"><div><p className="kicker">Daily briefing</p><h2>What deserves attention</h2></div><span>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date())}</span></div><div className="briefing-grid"><article className="briefing-lead"><span>{triggeredAlerts.length ? "Alert activity" : "Market pulse"}</span><h3>{triggeredAlerts.length ? `${triggeredAlerts.length} threshold${triggeredAlerts.length === 1 ? " has" : "s have"} been reached.` : `${advancing} of ${performers.length} positions are advancing.`}</h3><p>{triggeredAlerts.length ? "Review the triggered conditions below." : "No alert thresholds are active right now."}</p></article><article><span>Largest moves today</span><div className="briefing-list">{briefingMovers.map((stock) => <Link href={`/focus?ticker=${encodeURIComponent(stock.ticker)}`} key={stock.ticker}><b>{stock.ticker}</b><small>{stock.name}</small><strong className={tone(stock.day)}>{percent(stock.day)}</strong></Link>)}</div></article><article><span>Triggered alerts</span><div className="briefing-list">{triggeredAlerts.length ? triggeredAlerts.slice(0, 3).map((alert) => <Link href={`/focus?ticker=${encodeURIComponent(alert.ticker)}`} key={alert.id}><b>{alert.ticker}</b><small>{describeAlert(alert)}</small><strong>Reached</strong></Link>) : <div className="quiet-state">Create price or movement alerts from any Focus page.</div>}</div></article></div></section>}

      {storage !== "loading" && view === "heatmap" && <section className="heatmap-section route-section">
        <div className="section-title heatmap-title"><div><p className="kicker">Market field</p><h2>Performance field</h2></div><div className="heat-legend" aria-label="Continuous heat map scale"><span>Decline</span><i/><span>Advance</span></div></div>
        <div className="heatmap-groups">
          <section className={`heatmap-group equity-heatmap-group ${expandedHeatmaps.equities ? "" : "collapsed"}`} aria-labelledby="equity-map-title"><header><div className="heatmap-group-heading"><span>01</span><div><h3 id="equity-map-title">Company landscape</h3><p>Every equity, sized by market weight</p></div></div><button className="heatmap-toggle" type="button" aria-expanded={expandedHeatmaps.equities} aria-controls="equity-map-content" onClick={() => toggleHeatmap("equities")}><small>{expandedHeatmaps.equities ? "Hide" : "Show"} · {equityHeatmapStocks.length}</small></button></header><div id="equity-map-content" className="heatmap-content" aria-hidden={!expandedHeatmaps.equities}><div>{equityHeatmapStocks.length ? <PerformanceTreemap stocks={equityHeatmapStocks} period={period} theme={theme} groupLabel="equity"/> : <div className="heatmap-empty compact"><span>◉</span><p>Add an equity to build this market field.</p></div>}</div></div></section>
        </div>
        <p className="heatmap-note">{equityHeatmapStocks.length} equities · Color reflects {period} movement · Size reflects market weight</p>
      </section>}

      {storage !== "loading" && view === "focus" && <section className="focus-section route-section">
        <div className="focus-toolbar"><div><p className="kicker">Single-security view</p><h2>{focusedStock?.name || "Choose a position"}</h2></div><label className="ticker-selector"><span>Position</span><select value={focusedStock?.ticker || ""} onChange={(event) => { const value = event.target.value; setFocusedTicker(value); router.replace(`/focus?ticker=${encodeURIComponent(value)}`, { scroll: false }); }} aria-label="Choose a ticker to focus">{[...viewedStocks].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((stock) => <option value={stock.ticker} key={stock.ticker}>{stock.ticker} — {stock.name}</option>)}</select></label></div>
        {focusedStock ? <div className="focus-workspace">
          <article className="focus-primary"><div className="focus-identity"><span className="focus-monogram">{focusedStock.ticker.slice(0, 2)}</span><div><span>{focusedStock.assetType} · {focusedStock.sector}</span><h3>{focusedStock.ticker}</h3></div><strong>{money(focusedStock.price)}</strong></div><div className="focus-chart-head"><div className="focus-return"><span>{period} return</span><b className={tone(focusedStock.viewedReturn)}>{percent(focusedStock.viewedReturn)}</b></div><label>Compare with<select value={benchmarkTicker} onChange={(event) => setBenchmarkTicker(event.target.value)}>{Object.entries(benchmarks).map(([tickerValue, name]) => <option key={tickerValue} value={tickerValue}>{name}</option>)}</select></label></div><div className="focus-chart"><div className="chart-grid"><span>High</span><span>Avg</span><span>Low</span></div>{focusComparison ? <ComparisonChart data={focusComparison} label={`${focusedStock.ticker} performance over ${period}`} benchmarkName={benchmarks[benchmarkTicker]}/> : focusedChart ? <TimelineChart data={focusedChart} fillId="focusFill" label={`${focusedStock.ticker} performance over ${period}`}/> : <div className="chart-empty">Price history is unavailable</div>}</div>{focusComparison && <div className="comparison-legend"><span><i/> {focusedStock.ticker} <b className={tone(focusComparison.primaryReturn)}>{percent(focusComparison.primaryReturn)}</b></span><span><i/> {benchmarks[benchmarkTicker]} <b className={tone(focusComparison.benchmarkReturn)}>{percent(focusComparison.benchmarkReturn)}</b></span><strong className={tone(focusComparison.primaryReturn - focusComparison.benchmarkReturn)}>{percent(focusComparison.primaryReturn - focusComparison.benchmarkReturn)} relative</strong></div>}</article>
          <aside className="focus-metrics"><article><span>Today</span><strong className={tone(focusedStock.day)}>{percent(focusedStock.day)}</strong><p>Latest market session</p></article><article className="signal-card"><div><span>Aperture signal</span><button type="button" onClick={() => setSignalOpen((current) => !current)} aria-expanded={signalOpen}>?</button></div><strong>{Number.isFinite(focusedStock.signal) ? focusedStock.signal : "—"}<small> / 100</small></strong><p>Price momentum score</p>{signalOpen && <div className="signal-breakdown">{signalBreakdown(focusedStock).map((item) => <div key={item.label}><span>{item.label}<small>{item.note}</small></span><b className={tone(item.value)}>{item.value > 0 ? "+" : ""}{item.value.toFixed(1)}</b></div>)}<p>Rounded and capped between 0 and 100. Momentum is descriptive, not predictive.</p></div>}</article><article><span>52 week position</span><strong>{Number.isFinite(focusedStock.range) ? `${Math.round(focusedStock.range)}%` : "—"}</strong><div className="focus-range"><i style={{ left: `${focusedStock.range || 0}%` }}/></div><p>{money(focusedStock.fiftyTwoWeekLow)} low · {money(focusedStock.fiftyTwoWeekHigh)} high</p></article><article><span>Market</span><strong className={focusedStock.market?.status === "open" ? "positive" : "neutral"}>{focusedStock.market ? `${focusedStock.market.name} ${focusedStock.market.status}` : "Unavailable"}</strong><p>Regular trading session</p></article></aside>
          <section className="focus-details"><article><p className="label">Return profile</p><div className="return-profile">{Object.keys(periodBars).map((timeframe) => <div key={timeframe}><span>{timeframe}</span><strong className={tone(periodReturn(focusedStock, timeframe))}>{percent(periodReturn(focusedStock, timeframe))}</strong></div>)}</div></article><article><p className="label">Set an alert</p><form className="alert-form" onSubmit={addAlert}><select aria-label="Alert condition" value={alertCondition} disabled={alertsLoading} onChange={(event) => setAlertCondition(event.target.value)}><option value="above">Price rises above</option><option value="below">Price falls below</option><option value="move">Daily move reaches</option></select><div><span>{alertCondition === "move" ? "%" : "$"}</span><input type="number" min="0.01" step="0.01" required disabled={alertsLoading} value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} placeholder={alertCondition === "move" ? "5.00" : String(Math.round(focusedStock.price || 100))}/></div><button className="primary-button" disabled={alertsLoading}>{alertsLoading ? "Saving…" : "Create alert"}</button></form><div className="active-alerts">{alerts.filter((alert) => alert.ticker === focusedStock.ticker).map((alert) => <div key={alert.id}><span><b>{describeAlert(alert)}</b><small>{alertMatches(alert, focusedStock) ? "Triggered now" : "Watching"}</small></span><button type="button" disabled={alertsLoading} onClick={() => deleteAlert(alert)} aria-label={`Delete alert: ${describeAlert(alert)}`}>×</button></div>)}{!alertsLoading && !alerts.some((alert) => alert.ticker === focusedStock.ticker) && <p>No alerts for this position yet.</p>}</div></article></section>
        </div> : <div className="focus-empty"><span className="dialog-mark"><ApertureMark /></span><h2>Bring one position into focus.</h2><p>Add a ticker to compare performance, understand its signal, and create an alert.</p><button className="primary-button" onClick={() => setModal(true)}>＋ Add your first position</button></div>}
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
          <th><button className={sortBy === "sector" ? "active" : ""} onClick={() => sortTable("sector")}>Sector <span>{sortLabel("sector")}</span></button></th>
          <th><button className={sortBy === "price" ? "active" : ""} onClick={() => sortTable("price")}>Last price <span>{sortLabel("price")}</span></button></th>
          <th><button className={sortBy === "day" ? "active" : ""} onClick={() => sortTable("day")}>Today <span>{sortLabel("day")}</span></button></th>
          <th><button className={sortBy === "viewedReturn" ? "active" : ""} onClick={() => sortTable("viewedReturn")}>{period} return <span>{sortLabel("viewedReturn")}</span></button></th>
          <th><button className={sortBy === "range" ? "active" : ""} onClick={() => sortTable("range")}>52 week range <span>{sortLabel("range")}</span></button></th>
          <th><button className={sortBy === "signal" ? "active" : ""} onClick={() => sortTable("signal")}>Signal <span>{sortLabel("signal")}</span></button></th>
          <th><span className="sr-only">Actions</span></th>
        </tr></thead>{[["Equity", "Equities"], ["ETF", "Exchange-traded funds"]].map(([type, label]) => { const group = shown.filter((stock) => stock.assetType === type); return group.length > 0 && <tbody key={type}><tr className="asset-group-row"><td colSpan="8"><span>{label}</span><b>{group.length}</b></td></tr>{group.map(stockRow)}</tbody>; })}</table>{shown.length === 0 && <div className="empty-state"><strong>{stocks.length ? "No positions found" : "Your universe is ready to take shape"}</strong><p>{stocks.length ? "Adjust your search or filters to see more of your watchlist." : "Add a company or fund to create your first watchlist view."}</p><button onClick={() => stocks.length ? (setQuery(""), setMovement("all"), setAssetClass("all"), setSector("all")) : setModal(true)}>{stocks.length ? "Clear filters" : "Add first position"}</button></div>}</div>
      </section>}
    </main>

    <footer><div className="brand footer-brand"><span className="brand-mark"><ApertureMark /></span><span>Aperture</span></div><p>Clarity for considered investors.</p><span>Market data via Yahoo Finance · Informational only</span></footer>
    {timedAlerts[0] && <aside className="timed-alert" role="alert" aria-label={`Alert triggered for ${timedAlerts[0].ticker}`}>
      <div className="timed-alert-mark" aria-hidden="true">!</div>
      <div><span>Threshold reached</span><strong>{timedAlerts[0].ticker} · {describeAlert(timedAlerts[0])}</strong><p>{money(timedAlerts[0].stock?.price)} now · {percent(timedAlerts[0].stock?.day)} today</p></div>
      <Link href={`/focus?ticker=${encodeURIComponent(timedAlerts[0].ticker)}`} onClick={() => setTimedAlerts((current) => current.slice(1))}>View</Link>
      <button type="button" onClick={() => setTimedAlerts((current) => current.slice(1))} aria-label="Dismiss alert">×</button>
      <i aria-hidden="true" />
    </aside>}
    {modal && <div className="modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingTicker) setModal(false); }}><form className="dialog" onSubmit={addTicker} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-busy={savingTicker}><button className="dialog-close" type="button" disabled={savingTicker} onClick={() => setModal(false)} aria-label="Close">×</button><span className="dialog-mark"><ApertureMark /></span><p className="kicker">Expand your view</p><h2 id="dialog-title">Add to Aperture</h2><p>Enter a market ticker to bring the company into your watchlist.</p><label>Ticker symbol<input autoFocus value={ticker} disabled={savingTicker} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength="12" placeholder="e.g. AAPL" required aria-describedby="ticker-preview"/></label><div id="ticker-preview" className={`ticker-preview ${tickerPreview.status}`} aria-live="polite">{tickerPreview.status === "loading" && <><span className="button-spinner dark" aria-hidden="true"/><p>Looking up {tickerPreview.ticker}…</p></>}{tickerPreview.status === "success" && <><span className="ticker-preview-mark">{tickerPreview.ticker.slice(0, 2)}</span><div><strong>{tickerPreview.name}</strong><small>{tickerPreview.ticker} · {tickerPreview.assetType}{tickerPreview.exchange ? ` · ${tickerPreview.exchange}` : ""}</small></div><i aria-label="Ticker found">✓</i></>}{tickerPreview.status === "error" && <p>{tickerPreview.message}</p>}</div><div className="dialog-actions"><button className="secondary-button" type="button" disabled={savingTicker} onClick={() => setModal(false)}>Cancel</button><button className="primary-button" disabled={savingTicker || tickerPreview.status !== "success"} type="submit">{savingTicker && <span className="button-spinner" aria-hidden="true"/>}{savingTicker ? "Adding…" : "Add position"}</button></div></form></div>}
    <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
  </div>;
}
