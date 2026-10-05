import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getDatabase } from "@/lib/mongodb";

export const SESSION_COOKIE = "aperture_session";
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;
const scrypt = promisify(scryptCallback);

const digestToken = (token) => createHash("sha256").update(token).digest("hex");

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, storedHash] = String(stored || "").split(":");
  if (!salt || !storedHash) return false;
  const derived = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(storedHash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("sessions").insertOne({ tokenHash: digestToken(token), userId, createdAt: new Date(), expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(response, token, expiresAt) {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt, priority: "high" });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(0) });
  return response;
}

async function userForToken(token) {
  if (!token) return null;
  const db = await getDatabase();
  const session = await db.collection("sessions").findOne({ tokenHash: digestToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.userId }, { projection: { passwordHash: 0 } });
  return user ? { ...user, sessionId: session._id } : null;
}

export async function getRequestUser(request) {
  return userForToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function getCurrentUser() {
  const store = await cookies();
  return userForToken(store.get(SESSION_COOKIE)?.value);
}

export async function deleteRequestSession(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await getDatabase();
  await db.collection("sessions").deleteOne({ tokenHash: digestToken(token) });
}
