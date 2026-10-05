import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user: { id: user._id.toString(), name: user.name, email: user.email } });
}
