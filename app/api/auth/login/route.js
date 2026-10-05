import { NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { email: rawEmail, password: rawPassword } = await request.json();
    const email = String(rawEmail || "").trim().toLowerCase();
    const password = String(rawPassword || "");
    const db = await getDatabase();
    const user = await db.collection("users").findOne({ email });
    if (!user || !await verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    const session = await createSession(db, user._id);
    return setSessionCookie(NextResponse.json({ user: { id: user._id.toString(), name: user.name, email: user.email } }), session.token, session.expiresAt);
  } catch (error) {
    console.error("Login failed", error);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
