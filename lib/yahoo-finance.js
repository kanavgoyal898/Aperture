import YahooFinance from "yahoo-finance2";
import { getDatabase } from "@/lib/mongodb";

const yahooFinance = new YahooFinance();
const CACHE_TTL_MS = Number(process.env.MARKET_DATA_TTL_MS) || 60_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const change = (current, previous) => previous ? ((current - previous) / previous) * 100 : null;

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
    if (includeRange && Number.isFinite(quote.high) && Number.isFinite(quote.low)) return [{ ...bar, high: quote.high, low: quote.low }];
    return [bar];
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
  return { name: marketName(meta), status: Number.isFinite(start) && Number.isFinite(end) ? (now >= start && now < end ? "open" : "closed") : "unknown" };
}

function publicStock(record, status = record.marketDataStatus || "live") {
  return {
    ticker: record.ticker, name: record.name, sector: record.sector, assetType: record.assetType,
    market: record.market, price: record.price, day: record.day, month: record.month,
    marketCap: record.marketCap, volume: record.volume,
    signal: record.signal, range: record.range, history: record.history || [],
    intradayHistory: record.intradayHistory || [], hourlyHistory: record.hourlyHistory || [],
    maxHistory: record.maxHistory || [], marketDataStatus: status,
  };
}

async function hydrateStock(document, collection) {
  const ticker = document.ticker;
  const cached = await collection.findOne({ ticker });
  if (cached?.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_MS) return publicStock(cached);

  const now = new Date();
  const dailyFallback = new Date(now); dailyFallback.setUTCFullYear(dailyFallback.getUTCFullYear() - 3); dailyFallback.setUTCDate(dailyFallback.getUTCDate() - 7);
  const intradayFallback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hourlyFallback = new Date(now); hourlyFallback.setUTCMonth(hourlyFallback.getUTCMonth() - 6); hourlyFallback.setUTCDate(hourlyFallback.getUTCDate() - 7);
  const maxFallback = new Date("1970-01-02T00:00:00.000Z");
  const needsProfile = !cached?.profileUpdatedAt || Date.now() - new Date(cached.profileUpdatedAt).getTime() > 7 * 24 * 60 * 60 * 1000;

  try {
    const [chart, intradayChart, hourlyChart, maxChart, profile, quote] = await Promise.all([
      yahooFinance.chart(ticker, { period1: incrementalStart(cached, "history", dailyFallback, 2 * 24 * 60 * 60 * 1000), interval: "1d" }),
      yahooFinance.chart(ticker, { period1: incrementalStart(cached, "intradayHistory", intradayFallback, 15 * 60 * 1000), interval: "5m" }).catch(() => null),
      yahooFinance.chart(ticker, { period1: incrementalStart(cached, "hourlyHistory", hourlyFallback, 2 * 60 * 60 * 1000), interval: "1h" }).catch(() => null),
      yahooFinance.chart(ticker, { period1: incrementalStart(cached, "maxHistory", maxFallback, 45 * 24 * 60 * 60 * 1000), interval: "1mo" }).catch(() => null),
      needsProfile ? yahooFinance.quoteSummary(ticker, { modules: ["assetProfile"] }).catch(() => null) : null,
      yahooFinance.quote(ticker).catch(() => null),
    ]);

    const oldestDaily = new Date(now); oldestDaily.setUTCFullYear(oldestDaily.getUTCFullYear() - 3); oldestDaily.setUTCDate(oldestDaily.getUTCDate() - 14);
    const oldestIntraday = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const oldestHourly = new Date(now); oldestHourly.setUTCMonth(oldestHourly.getUTCMonth() - 6); oldestHourly.setUTCDate(oldestHourly.getUTCDate() - 14);
    const history = mergeHistory(cached?.history, compactHistory(chart, true), oldestDaily);
    const intradayHistory = mergeHistory(cached?.intradayHistory, compactHistory(intradayChart), oldestIntraday);
    const hourlyHistory = mergeHistory(cached?.hourlyHistory, compactHistory(hourlyChart), oldestHourly);
    const maxHistory = mergeHistory(cached?.maxHistory, compactHistory(maxChart));
    const latest = history.at(-1);
    if (!latest) throw new Error("No price history found");

    const monthAgo = new Date(); monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    const price = chart.meta.regularMarketPrice ?? latest.close;
    const rangedBars = history.filter((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.low));
    const low = chart.meta.fiftyTwoWeekLow ?? Math.min(...rangedBars.map((bar) => bar.low));
    const high = chart.meta.fiftyTwoWeekHigh ?? Math.max(...rangedBars.map((bar) => bar.high));
    const month = change(price, closeAtOrBefore(history, monthAgo));
    const day = chart.meta.regularMarketChangePercent ?? change(price, chart.meta.previousClose ?? history.at(-2)?.close);
    const range = Number.isFinite(low) && Number.isFinite(high) && high !== low ? ((price - low) / (high - low)) * 100 : 50;
    const signal = clamp(Math.round(50 + (month || 0) * 1.5 + (day || 0) * 2), 0, 100);
    const assetType = String(chart.meta.instrumentType || cached?.assetType || "").toUpperCase() === "ETF" ? "ETF" : "Equity";
    const sector = profile?.assetProfile?.sector || cached?.sector || document.sector || (assetType === "ETF" ? "Exchange-traded fund" : "Equity");
    const record = {
      ticker, name: chart.meta.longName || chart.meta.shortName || cached?.name || document.name || ticker,
      sector, assetType, market: marketSession(chart.meta), price, day, month, signal,
      marketCap: quote?.marketCap ?? cached?.marketCap ?? null,
      volume: quote?.regularMarketVolume ?? cached?.volume ?? null,
      range: clamp(range, 0, 100), history, intradayHistory, hourlyHistory, maxHistory,
      marketDataStatus: "live", updatedAt: now,
      profileUpdatedAt: profile ? now : cached?.profileUpdatedAt || null,
    };
    await collection.updateOne({ ticker }, { $set: record, $setOnInsert: { createdAt: now } }, { upsert: true });
    return publicStock(record);
  } catch (error) {
    console.error(`Yahoo Finance refresh failed for ${ticker}`, error);
    if (cached) return publicStock(cached, "cached");
    return { ticker, name: document.name || ticker, sector: document.sector || "Equity", assetType: document.assetType || "Equity", market: document.market || null, marketDataStatus: "unavailable", history: [], intradayHistory: [], hourlyHistory: [], maxHistory: [] };
  }
}

export async function hydrateStocks(documents, database) {
  const db = database || await getDatabase();
  const collection = db.collection("market_data");
  await collection.createIndex({ ticker: 1 }, { unique: true });
  return Promise.all(documents.map((document) => hydrateStock(document, collection)));
}
