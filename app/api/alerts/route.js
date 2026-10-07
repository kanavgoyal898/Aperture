import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getRequestUser } from "@/lib/auth";

export const runtime = "nodejs";

const CONDITIONS = new Set(["above", "below", "move"]);
const serialize = (alert) => ({ id: alert._id.toString(), ticker: alert.ticker, condition: alert.condition, threshold: alert.threshold, createdAt: alert.createdAt });

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDatabase();
    const alerts = await db.collection("alerts").find({ userId: user._id }).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(alerts.map(serialize));
  } catch (error) {
    console.error("Alerts GET failed", error);
    return NextResponse.json({ error: "Could not load alerts." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const ticker = String(body.ticker || "").trim().toUpperCase();
    const condition = String(body.condition || "");
    const threshold = Number(body.threshold);
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(ticker) || !CONDITIONS.has(condition) || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1_000_000_000) {
      return NextResponse.json({ error: "Enter a valid alert condition and threshold." }, { status: 400 });
    }
    const db = await getDatabase();
    const watched = await db.collection("watchlist").findOne({ userId: user._id, ticker }, { projection: { _id: 1 } });
    if (!watched) return NextResponse.json({ error: "Add this ticker to your watchlist before creating an alert." }, { status: 404 });
    const result = await db.collection("alerts").findOneAndUpdate(
      { userId: user._id, ticker, condition, threshold },
      { $setOnInsert: { userId: user._id, ticker, condition, threshold, createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return NextResponse.json(serialize(result), { status: 201 });
  } catch (error) {
    console.error("Alerts POST failed", error);
    return NextResponse.json({ error: "Could not create this alert." }, { status: 503 });
  }
}
