let indexesPromise;

export function ensureDatabaseIndexes(db) {
  if (!indexesPromise) {
    indexesPromise = Promise.all([
      db.collection("watchlist").dropIndex("ticker_1").catch((error) => {
        if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
      }),
      db.collection("watchlist").createIndex({ userId: 1, ticker: 1 }, { unique: true }),
      db.collection("watchlist").createIndex({ userId: 1, order: 1, createdAt: 1 }),
      db.collection("market_data").createIndex({ ticker: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("sessions").createIndex({ tokenHash: 1 }),
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
    ]).catch((error) => {
      indexesPromise = undefined;
      throw error;
    });
  }
  return indexesPromise;
}
