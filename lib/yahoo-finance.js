import { getDatabase } from "@/lib/mongodb";
import { getMarketDataProvider } from "@/lib/market-data/provider";

const marketDataProvider = getMarketDataProvider();
const refreshes = new Map();
const TTL = {
  quote: Number(process.env.MARKET_DATA_TTL_MS) || 60_000,
  intraday: 2 * 60_000,
  hourly: 30 * 60_000,
  daily: 15 * 60_000,
  max: 24 * 60 * 60_000,
  profile: 7 * 24 * 60 * 60_000,
};
const PERIODS = {
  "1D": { field: "intradayHistory", session: true },
  "1W": { field: "hourlyHistory", days: 7 },
  "1M": { field: "hourlyHistory", days: 31 },
  "3M": { field: "hourlyHistory", days: 93 },
  "6M": { field: "hourlyHistory", days: 186 },
  "1Y": { field: "history", days: 366 },
  "3Y": { field: "history", days: 1100 },
  Max: { field: "maxHistory" },
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const change = (current, previous) => previous ? ((current - previous) / previous) * 100 : null;
const isFresh = (value, ttl) => value && Date.now() - new Date(value).getTime() < ttl;

function closeAtOrBefore(bars, target) {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (new Date(bars[index].date) <= target) return bars[index].close;
  }
  return bars[0]?.close;
}

function compactHistory(chart, includeRange = false) {
  return (chart?.quotes || []).flatMap((quote) => {
    if (!Number.isFinite(quote.close)) return [];
    const bar = { date: quote.date.toISOString(), close: quote.adjclose ?? quote.close };
    return includeRange && Number.isFinite(quote.high) && Number.isFinite(quote.low) ? [{ ...bar, high: quote.high, low: quote.low }] : [bar];
  });
}

function mergeHistory(existing = [], incoming = [], oldestAllowed = null) {
  const merged = new Map([...existing, ...incoming].map((bar) => [bar.date, bar]));
  return [...merged.values()]
    .filter((bar) => !oldestAllowed || new Date(bar.date) >= oldestAllowed)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function incrementalStart(cache, field, fallback, overlapMs) {
  const last = cache?.[field]?.at(-1)?.date;
  return last ? new Date(new Date(last).getTime() - overlapMs) : fallback;
}

function marketName(meta) {
  const timezone = meta.exchangeTimezoneName || "";
  if (/Kolkata|Calcutta/.test(timezone)) return "India";
  if (/New_York/.test(timezone)) return "US";
  if (/London/.test(timezone)) return "UK";
  if (/Tokyo/.test(timezone)) return "Japan";
  if (/Hong_Kong/.test(timezone)) return "Hong Kong";
  if (/Shanghai/.test(timezone)) return "China";
  if (/Sydney/.test(timezone)) return "Australia";
  if (/Toronto/.test(timezone)) return "Canada";
  return meta.exchangeName || meta.fullExchangeName || "Market";
}

function marketSession(meta) {
  const regular = meta.currentTradingPeriod?.regular;
  const seconds = (value) => value instanceof Date ? value.getTime() / 1000 : Number(value);
  const start = seconds(regular?.start), end = seconds(regular?.end), now = Date.now() / 1000;
  const timedStatus = Number.isFinite(start) && Number.isFinite(end) ? (now >= start && now < end ? "open" : "closed") : null;
  const quoteStatus = meta.marketState ? (meta.marketState === "REGULAR" ? "open" : "closed") : null;
  return { name: marketName(meta), status: timedStatus || quoteStatus || "unknown" };
}

function seriesForPeriod(record, period) {
  const config = PERIODS[period] || PERIODS["1D"];
  let history = record[config.field] || [];
  // A one-day chart must never borrow daily candles from another session.
  // With insufficient intraday data, returning an empty series keeps the chart blank.
  if (history.length < 2 && config.session) return [];
  if (history.length < 2) history = record.history || [];
  if (history.length < 2 || period === "Max") return history;
  if (config.session) {
    let start = 0;
    for (let index = history.length - 1; index > 0; index -= 1) {
      if (new Date(history[index].date) - new Date(history[index - 1].date) > 2 * 60 * 60_000) { start = index; break; }
    }
    return history.slice(start);
  }
  const cutoff = new Date(history.at(-1).date).getTime() - config.days * 24 * 60 * 60_000;
  return history.filter((bar) => new Date(bar.date).getTime() >= cutoff);
}

function periodReturn(record, period) {
  const history = seriesForPeriod(record, period);
  return history.length > 1 ? change(history.at(-1).close, history[0].close) : null;
}

function downsample(history, limit = 360) {
  if (history.length <= limit) return history.map(({ date, close }) => ({ date, close }));
  return Array.from({ length: limit }, (_, index) => {
    const { date, close } = history[Math.round(index * (history.length - 1) / (limit - 1))];
    return { date, close };
  });
}

function publicStock(record, status = record.marketDataStatus || "live") {
  return {
    ticker: record.ticker, name: record.name, sector: record.sector, assetType: record.assetType,
    market: record.market, price: record.price, day: record.day, month: record.month,
    marketCap: record.marketCap, volume: record.volume, signal: record.signal, range: record.range,
    fiftyTwoWeekLow: record.fiftyTwoWeekLow, fiftyTwoWeekHigh: record.fiftyTwoWeekHigh,
    returns: Object.fromEntries(Object.keys(PERIODS).map((period) => [period, periodReturn(record, period)])),
    dataProvider: marketDataProvider.attribution,
    marketDataStatus: status,
  };
}

function historyFieldForPeriod(period) {
  return (PERIODS[period] || PERIODS["1D"]).field;
}

async function refreshStock(document, collection, period, force = false) {
  const ticker = document.ticker;
  const cached = await collection.findOne({ ticker });
  const now = new Date();
  const dailyFallback = new Date(now); dailyFallback.setUTCFullYear(dailyFallback.getUTCFullYear() - 3); dailyFallback.setUTCDate(dailyFallback.getUTCDate() - 7);
  const intradayFallback = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const hourlyFallback = new Date(now); hourlyFallback.setUTCMonth(hourlyFallback.getUTCMonth() - 6); hourlyFallback.setUTCDate(hourlyFallback.getUTCDate() - 7);
  const maxFallback = new Date("1970-01-02T00:00:00.000Z");
  const requestedField = period ? historyFieldForPeriod(period) : null;
  const refreshAllHistory = period === "all";
  const needsDaily = force || !cached?.history?.length || !isFresh(cached.dailyUpdatedAt, TTL.daily);
  const needsIntraday = force || !cached?.intradayHistory?.length || (refreshAllHistory || requestedField === "intradayHistory") && !isFresh(cached.intradayUpdatedAt, TTL.intraday);
  const needsHourly = force || !cached?.hourlyHistory?.length || (refreshAllHistory || requestedField === "hourlyHistory") && !isFresh(cached.hourlyUpdatedAt, TTL.hourly);
  const needsMax = force || !cached?.maxHistory?.length || (refreshAllHistory || requestedField === "maxHistory") && !isFresh(cached.maxUpdatedAt, TTL.max);
  const needsQuote = force || !cached || !isFresh(cached.quoteUpdatedAt, TTL.quote);
  const needsProfile = !cached?.profileUpdatedAt || !isFresh(cached.profileUpdatedAt, TTL.profile);

  if (cached && !needsDaily && !needsIntraday && !needsHourly && !needsMax && !needsQuote && !needsProfile) return cached;

  try {
    const [dailyChart, intradayChart, hourlyChart, maxChart, profile, quote] = await Promise.all([
      needsDaily ? marketDataProvider.chart(ticker, { period1: incrementalStart(cached, "history", dailyFallback, 2 * 24 * 60 * 60_000), interval: "1d" }) : null,
      needsIntraday ? marketDataProvider.chart(ticker, { period1: incrementalStart(cached, "intradayHistory", intradayFallback, 15 * 60_000), interval: "5m" }).catch(() => null) : null,
      needsHourly ? marketDataProvider.chart(ticker, { period1: incrementalStart(cached, "hourlyHistory", hourlyFallback, 2 * 60 * 60_000), interval: "1h" }).catch(() => null) : null,
      needsMax ? marketDataProvider.chart(ticker, { period1: incrementalStart(cached, "maxHistory", maxFallback, 45 * 24 * 60 * 60_000), interval: "1mo" }).catch(() => null) : null,
      needsProfile ? marketDataProvider.profile(ticker).catch(() => null) : null,
      needsQuote ? marketDataProvider.quote(ticker).catch(() => null) : null,
    ]);

    const oldestDaily = new Date(now); oldestDaily.setUTCFullYear(oldestDaily.getUTCFullYear() - 3); oldestDaily.setUTCDate(oldestDaily.getUTCDate() - 14);
    const oldestIntraday = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    const oldestHourly = new Date(now); oldestHourly.setUTCMonth(oldestHourly.getUTCMonth() - 6); oldestHourly.setUTCDate(oldestHourly.getUTCDate() - 14);
    const history = mergeHistory(cached?.history, compactHistory(dailyChart, true), oldestDaily);
    const intradayHistory = mergeHistory(cached?.intradayHistory, compactHistory(intradayChart), oldestIntraday);
    const hourlyHistory = mergeHistory(cached?.hourlyHistory, compactHistory(hourlyChart), oldestHourly);
    const maxHistory = mergeHistory(cached?.maxHistory, compactHistory(maxChart));
    const latest = history.at(-1);
    if (!latest) throw new Error("No price history found");

    const meta = dailyChart?.meta || {};
    const monthAgo = new Date(now); monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    const price = quote?.regularMarketPrice ?? meta.regularMarketPrice ?? cached?.price ?? latest.close;
    const rangedBars = history.filter((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low));
    const low = quote?.fiftyTwoWeekLow ?? meta.fiftyTwoWeekLow ?? Math.min(...rangedBars.map((bar) => bar.low));
    const high = quote?.fiftyTwoWeekHigh ?? meta.fiftyTwoWeekHigh ?? Math.max(...rangedBars.map((bar) => bar.high));
    const month = change(price, closeAtOrBefore(history, monthAgo));
    const day = quote?.regularMarketChangePercent ?? meta.regularMarketChangePercent ?? change(price, meta.previousClose ?? history.at(-2)?.close);
    const range = Number.isFinite(low) && Number.isFinite(high) && high !== low ? ((price - low) / (high - low)) * 100 : cached?.range ?? 50;
    const instrumentType = quote?.quoteType || meta.instrumentType || cached?.assetType;
    const assetType = String(instrumentType || "").toUpperCase() === "ETF" ? "ETF" : "Equity";
    const marketMeta = Object.keys(meta).length ? meta : quote || {};
    const record = {
      ticker, name: quote?.longName || quote?.shortName || meta.longName || meta.shortName || cached?.name || document.name || ticker,
      sector: profile?.assetProfile?.sector || cached?.sector || document.sector || (assetType === "ETF" ? "Exchange-traded fund" : "Equity"),
      assetType, market: Object.keys(marketMeta).length ? marketSession(marketMeta) : cached?.market || null,
      price, day, month, signal: clamp(Math.round(50 + (month || 0) * 1.5 + (day || 0) * 2), 0, 100),
      marketCap: quote?.marketCap ?? cached?.marketCap ?? null,
      volume: quote?.regularMarketVolume ?? cached?.volume ?? null,
      range: clamp(range, 0, 100), fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high,
      history, intradayHistory, hourlyHistory, maxHistory,
      marketDataStatus: "live", updatedAt: now,
      quoteUpdatedAt: needsQuote ? now : cached?.quoteUpdatedAt,
      dailyUpdatedAt: needsDaily && dailyChart ? now : cached?.dailyUpdatedAt,
      intradayUpdatedAt: needsIntraday && intradayChart ? now : cached?.intradayUpdatedAt,
      hourlyUpdatedAt: needsHourly && hourlyChart ? now : cached?.hourlyUpdatedAt,
      maxUpdatedAt: needsMax && maxChart ? now : cached?.maxUpdatedAt,
      profileUpdatedAt: profile ? now : cached?.profileUpdatedAt || null,
    };
    await collection.updateOne({ ticker }, { $set: record, $setOnInsert: { createdAt: now } }, { upsert: true });
    return record;
  } catch (error) {
    console.error(`Yahoo Finance refresh failed for ${ticker}`, error);
    if (cached) return { ...cached, marketDataStatus: "cached" };
    return { ticker, name: document.name || ticker, sector: document.sector || "Equity", assetType: document.assetType || "Equity", market: document.market || null, marketDataStatus: "unavailable", history: [], intradayHistory: [], hourlyHistory: [], maxHistory: [] };
  }
}

async function hydrateStock(document, collection, period, force) {
  const key = `${document.ticker}:${period || "summary"}:${force ? "force" : "normal"}`;
  if (!refreshes.has(key)) refreshes.set(key, refreshStock(document, collection, period, force).finally(() => refreshes.delete(key)));
  return refreshes.get(key);
}

async function mapWithConcurrency(items, limit, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function serializeRecords(records, { period, includeHistory }) {
  if (includeHistory) return records.map((record) => ({ ticker: record.ticker, history: downsample(seriesForPeriod(record, period)) }));
  return records.map((record) => publicStock(record, record.marketDataStatus));
}

export async function getStocksSnapshot(documents, database, { period = null, includeHistory = false } = {}) {
  if (!documents.length) return [];
  const db = database || await getDatabase();
  const records = await db.collection("market_data").find({ ticker: { $in: documents.map(({ ticker }) => ticker) } }).toArray();
  const byTicker = new Map(records.map((record) => [record.ticker, record]));
  if (documents.some(({ ticker }) => !byTicker.has(ticker))) return null;
  const orderedRecords = documents.map(({ ticker }) => byTicker.get(ticker));
  if (includeHistory && orderedRecords.some((record) => seriesForPeriod(record, period).length < 2)) return null;
  return serializeRecords(orderedRecords, { period, includeHistory });
}

export async function hydrateStocks(documents, database, { period = null, includeHistory = false, force = false, concurrency = 8 } = {}) {
  const db = database || await getDatabase();
  const collection = db.collection("market_data");
  const records = await mapWithConcurrency(documents, concurrency, (document) => hydrateStock(document, collection, period, force));
  return serializeRecords(records, { period, includeHistory });
}
