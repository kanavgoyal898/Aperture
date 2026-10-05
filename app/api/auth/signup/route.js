import { NextResponse } from "next/server";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return NextResponse.json({ error: "Use at least 8 characters with a letter and number." }, { status: 400 });

    const db = await getDatabase();
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    const result = await db.collection("users").insertOne({ name, email, passwordHash: await hashPassword(password), createdAt: new Date() });
    const session = await createSession(db, result.insertedId);
    return setSessionCookie(NextResponse.json({ user: { id: result.insertedId.toString(), name, email } }, { status: 201 }), session.token, session.expiresAt);
  } catch (error) {
    if (error?.code === 11000) return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
    console.error("Sign up failed", error);
    return NextResponse.json({ error: "Could not create your account." }, { status: 500 });
  }
}
