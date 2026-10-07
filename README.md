# Aperture


Aperture is a private, multi-user market watchlist built with Next.js. It combines live Yahoo Finance quotes with MongoDB-backed historical caching, responsive performance visualizations, focused ticker analysis, and LLM-ready data export.

![Aperture](./image.png)

## Features

- Email and password authentication with HTTP-only sessions
- Separate watchlists for every user
- Equity and ETF classification
- Market-aware live/closed indicators for US, Indian, and other exchanges
- Automatic background refresh with per-user browser caching
- Incremental MongoDB history caching to avoid downloading complete datasets repeatedly
- Timeframes: `1D`, `1W`, `1M`, `3M`, `6M`, `1Y`, `3Y`, and `Max`
- High-resolution five-minute, hourly, daily, and monthly history
- Interactive timeline charts with hover details
- S&P 500 and Nasdaq 100 benchmark comparisons
- Transparent Aperture signal breakdowns based on session and one-month momentum
- Account-synced price and daily-move alerts with a live daily briefing
- Separate ECharts performance treemaps for equities and ETFs
- Search, filtering, grouping, and sortable watchlist tables
- Dedicated `/focus` view with benchmark overlays, multi-period returns, 52-week levels, and alerts
- Guided onboarding and purpose-built empty states
- Responsive light and dark themes
- LLM-ready JSONL watchlist export

## Technology

- [Next.js](https://nextjs.org/) App Router
- React
- MongoDB
- [Yahoo Finance 2](https://github.com/gadicc/node-yahoo-finance2)
- [Apache ECharts](https://echarts.apache.org/)

## Requirements

- Node.js 20 or newer
- npm
- A MongoDB deployment accessible through a connection string

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` in the project root:

   ```dotenv
   MONGODB_URI=mongodb+srv://username:password@cluster.example.mongodb.net/
   MONGODB_DB=aperture
   MARKET_DATA_TTL_MS=60000
   MARKET_DATA_PROVIDER=yahoo
   CRON_SECRET=replace-with-a-long-random-secret
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and create an account.

`MONGODB_URI` is required. `MONGODB_DB` defaults to `aperture`, `MARKET_DATA_PROVIDER` defaults to `yahoo`, and `MARKET_DATA_TTL_MS` defaults to 60 seconds. `CRON_SECRET` is required only for scheduled refreshes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create and validate a production build |
| `npm start` | Serve the production build |

## Routes

| Route | Description |
| --- | --- |
| `/` | Watchlist overview and aggregate performance |
| `/heatmap` | Separate equity and ETF performance treemaps |
| `/focus?ticker=AAPL` | Single-ticker analysis |
| `/watchlist` | Searchable and sortable watchlist management |
| `/login` | Sign in and account creation |

All application routes except `/login` require a valid session.

## Market-data caching

Aperture stores hydrated ticker data in MongoDB's `market_data` collection. When cached data expires, it requests only the history following the latest stored bar, with a small overlap to account for corrections.

The stored resolutions are:

| Range | Resolution |
| --- | --- |
| `1D` | 5 minutes |
| `1W`–`6M` | 1 hour |
| `1Y`–`3Y` | 1 day |
| `Max` | 1 month |

The API serves MongoDB snapshots immediately and uses Next.js post-response work to refresh stale provider data without holding up the response. The browser also keeps the signed-in user's latest watchlist response in namespaced local storage. Cached content renders immediately while the API refreshes in the background. Polling pauses in hidden tabs and resumes when the page becomes active.

### Scheduled refresh

Configure a scheduler to call the following endpoint with the same `CRON_SECRET` configured in the application:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain.example/api/market-data/refresh
```

A one-minute schedule keeps quotes warm during active use. Longer history and company-profile requests retain their independent TTLs, so the scheduled job does not redownload every dataset on each run. The job deduplicates tickers shared by multiple users and limits provider concurrency.

Provider SDK calls are isolated under `lib/market-data/providers`. Adding another provider requires implementing the same `chart`, `quote`, and `profile` methods and registering it in `lib/market-data/provider.js`.

## Authentication and storage

Passwords are hashed with Node.js `scrypt`. Session tokens are random, stored as SHA-256 digests in MongoDB, and delivered through HTTP-only, same-site cookies. Expired sessions are removed automatically through a MongoDB TTL index.

The application creates and manages these collections:

- `users`
- `sessions`
- `watchlist`
- `alerts`
- `market_data`

Never commit `.env` or a MongoDB connection string.

## JSONL export

Use **Account → Export JSONL** to download one self-contained record per ticker. Records include:

- Asset and exchange metadata
- Current quote, market cap, and volume
- Returns for every supported timeframe
- Aperture signal and 52-week position
- Five-minute, hourly, daily, and monthly histories
- Schema version, export time, and source attribution

The export excludes the user's name and email address. It is suitable for streaming ingestion, embeddings, retrieval pipelines, and LLM inference workflows.

## Production

Validate and run the production build with:

```bash
npm run build
npm start
```

Configure the same environment variables in the production runtime. Use HTTPS so the session cookie receives its production `Secure` attribute.

## Data notice

Market data is provided through Yahoo Finance and may be delayed, incomplete, or temporarily unavailable. Aperture is intended for informational use and is not financial advice.
