import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getMarketDataProvider } from "@/lib/market-data/provider";

export const runtime = "nodejs";

const provider = getMarketDataProvider();

export async function GET(request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ticker = String(new URL(request.url).searchParams.get("ticker") || "").trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ error: "Enter a valid Yahoo Finance ticker." }, { status: 400 });
    }

    const quote = await provider.quote(ticker);
    const name = quote?.longName || quote?.shortName;
    if (!name) return NextResponse.json({ error: "No company was found for this ticker." }, { status: 404 });

    return NextResponse.json({
      ticker,
      name,
      assetType: String(quote.quoteType || "Equity").toUpperCase() === "ETF" ? "ETF" : "Equity",
      exchange: quote.fullExchangeName || quote.exchange || "",
    });
  } catch (error) {
    console.error("Ticker lookup failed", error);
    return NextResponse.json({ error: "No company was found for this ticker." }, { status: 404 });
  }
}
