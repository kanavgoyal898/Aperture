import { MongoClient } from "mongodb";
import { ensureDatabaseIndexes } from "@/lib/database-indexes";

const uri = process.env.MONGODB_URI;
const options = {};

let clientPromise;

function getClientPromise() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (process.env.NODE_ENV === "development") {
    if (!global._apertureMongoClientPromise) {
      const client = new MongoClient(uri, options);
      global._apertureMongoClientPromise = client.connect().catch((error) => {
        delete global._apertureMongoClientPromise;
        throw error;
      });
    }
    return global._apertureMongoClientPromise;
  }

  if (!clientPromise) {
    const client = new MongoClient(uri, options);
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

export async function getDatabase() {
  const connectedClient = await getClientPromise();
  const database = connectedClient.db(process.env.MONGODB_DB || "aperture");
  await ensureDatabaseIndexes(database);
  return database;
}
