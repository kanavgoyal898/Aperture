import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { hydrateStocks } from "@/lib/yahoo-finance";
import { getRequestUser } from "@/lib/auth";

export const runtime = "nodejs";

async function prepareWatchlist(collection) {
  await collection.dropIndex("ticker_1").catch((error) => { if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error; });
  await collection.createIndex({ userId: 1, ticker: 1 }, { unique: true });
}

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDatabase();
    const collection = db.collection("watchlist");
    await prepareWatchlist(collection);
    const stocks = await collection.find({ userId: user._id }, { projection: { ticker: 1, name: 1, sector: 1 } }).sort({ order: 1, createdAt: 1 }).toArray();
    return NextResponse.json(await hydrateStocks(stocks, db));
  } catch (error) {
    console.error("Watchlist GET failed", error);
    return NextResponse.json({ error: "Market data is unavailable. Check the MongoDB connection and Yahoo Finance access." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const ticker = String(body.ticker || "").trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ error: "Enter a valid Yahoo Finance ticker." }, { status: 400 });
    }
    const db = await getDatabase();
    const collection = db.collection("watchlist");
    await prepareWatchlist(collection);
    const existing = await collection.findOne({ userId: user._id, ticker });
    if (existing) return NextResponse.json({ error: `${ticker} is already tracked.` }, { status: 409 });
    const [stock] = await hydrateStocks([{ ticker }], db);
    if (stock.marketDataStatus === "unavailable") {
      return NextResponse.json({ error: "No Yahoo Finance market data was found for this ticker." }, { status: 422 });
    }
    await collection.insertOne({ userId: user._id, ticker, order: -1, createdAt: new Date() });
    return NextResponse.json(stock, { status: 201 });
  } catch (error) {
    console.error("Watchlist POST failed", error);
    return NextResponse.json({ error: "Could not save this ticker." }, { status: 503 });
  }
}
