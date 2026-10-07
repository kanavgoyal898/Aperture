import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getRequestUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ticker: rawTicker } = await params;
    const ticker = String(rawTicker || "").trim().toUpperCase();
    const db = await getDatabase();
    const result = await db.collection("watchlist").deleteOne({ userId: user._id, ticker });
    if (!result.deletedCount) return NextResponse.json({ error: "Ticker not found." }, { status: 404 });
    await db.collection("alerts").deleteMany({ userId: user._id, ticker });
    return NextResponse.json({ ticker, status: "removed" });
  } catch (error) {
    console.error("Watchlist DELETE failed", error);
    return NextResponse.json({ error: "Could not remove this ticker." }, { status: 503 });
  }
}
