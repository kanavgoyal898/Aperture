import YahooFinance from "yahoo-finance2";

const client = new YahooFinance();
const RETRYABLE_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function withRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || error?.code);
    if (Number.isFinite(status) && !RETRYABLE_CODES.has(status)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
}

export const yahooMarketDataProvider = {
  id: "yahoo",
  attribution: "Yahoo Finance",
  chart(ticker, options) {
    return withRetry(() => client.chart(ticker, options));
  },
  quote(ticker) {
    return withRetry(() => client.quote(ticker));
  },
  profile(ticker) {
    return withRetry(() => client.quoteSummary(ticker, { modules: ["assetProfile"] }));
  },
};
