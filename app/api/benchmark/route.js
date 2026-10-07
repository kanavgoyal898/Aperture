import { after, NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getRequestUser } from "@/lib/auth";
import { getStocksSnapshot, hydrateStocks } from "@/lib/yahoo-finance";

export const runtime = "nodejs";
export const maxDuration = 60;

const BENCHMARKS = new Map([
  ["^GSPC", "S&P 500"],
  ["^NDX", "Nasdaq 100"],
]);
const PERIODS = new Set(["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "Max"]);

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const ticker = params.get("ticker") || "^GSPC";
    const period = params.get("period") || "1D";
    if (!BENCHMARKS.has(ticker) || !PERIODS.has(period)) {
      return NextResponse.json({ error: "Unsupported benchmark or timeframe." }, { status: 400 });
    }
    const db = await getDatabase();
    const document = { ticker, name: BENCHMARKS.get(ticker), assetType: "ETF" };
    const summaryOptions = {};
    const historyOptions = { period, includeHistory: true };
    let summary = await getStocksSnapshot([document], db, summaryOptions);
    let history = await getStocksSnapshot([document], db, historyOptions);
    if (!summary || !history) {
      summary = await hydrateStocks([document], db, summaryOptions);
      history = await hydrateStocks([document], db, historyOptions);
    } else {
      after(async () => {
        try {
          await hydrateStocks([document], db, summaryOptions);
          await hydrateStocks([document], db, historyOptions);
        } catch (error) {
          console.error("Background benchmark refresh failed", error);
        }
      });
    }
    return NextResponse.json({ ...summary[0], name: BENCHMARKS.get(ticker), history: history[0]?.history || [] });
  } catch (error) {
    console.error("Benchmark GET failed", error);
    return NextResponse.json({ error: "Benchmark data is unavailable." }, { status: 503 });
  }
}
