import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getRequestUser } from "@/lib/auth";
import { hydrateStocks } from "@/lib/yahoo-finance";

export const runtime = "nodejs";

const PERIODS = new Set(["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "Max"]);

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const period = new URL(request.url).searchParams.get("period") || "1D";
    if (!PERIODS.has(period)) return NextResponse.json({ error: "Unsupported timeframe." }, { status: 400 });
    const db = await getDatabase();
    const stocks = await db.collection("watchlist")
      .find({ userId: user._id }, { projection: { ticker: 1, name: 1, sector: 1 } })
      .sort({ order: 1, createdAt: 1 })
      .toArray();
    return NextResponse.json(await hydrateStocks(stocks, db, { period, includeHistory: true }));
  } catch (error) {
    console.error("Watchlist history GET failed", error);
    return NextResponse.json({ error: "Price history is unavailable." }, { status: 503 });
  }
}
