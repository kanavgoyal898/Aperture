import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { hydrateStocks } from "@/lib/yahoo-finance";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

async function refresh(request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Scheduled refresh is not configured." }, { status: 503 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const startedAt = Date.now();
    const db = await getDatabase();
    const tickers = await db.collection("watchlist").distinct("ticker");
    const documents = tickers.map((ticker) => ({ ticker }));
    const stocks = await hydrateStocks(documents, db, { period: "all", concurrency: 4 });
    const unavailable = stocks.filter((stock) => stock.marketDataStatus === "unavailable").map((stock) => stock.ticker);
    return NextResponse.json({ refreshed: stocks.length - unavailable.length, unavailable, durationMs: Date.now() - startedAt });
  } catch (error) {
    console.error("Scheduled market-data refresh failed", error);
    return NextResponse.json({ error: "Scheduled refresh failed." }, { status: 503 });
  }
}

export const GET = refresh;
export const POST = refresh;
