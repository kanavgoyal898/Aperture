import { NextResponse } from "next/server";
import { clearSessionCookie, deleteRequestSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request) {
  await deleteRequestSession(request).catch((error) => console.error("Session deletion failed", error));
  return clearSessionCookie(NextResponse.json({ status: "signed-out" }));
}
