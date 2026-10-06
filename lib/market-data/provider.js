import { yahooMarketDataProvider } from "@/lib/market-data/providers/yahoo";

const providers = new Map([
  [yahooMarketDataProvider.id, yahooMarketDataProvider],
]);

export function getMarketDataProvider() {
  const providerId = String(process.env.MARKET_DATA_PROVIDER || "yahoo").toLowerCase();
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Unsupported market-data provider: ${providerId}`);
  return provider;
}
