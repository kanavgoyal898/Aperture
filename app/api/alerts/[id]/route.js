import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";
import { getRequestUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    const db = await getDatabase();
    const result = await db.collection("alerts").deleteOne({ _id: new ObjectId(id), userId: user._id });
    if (!result.deletedCount) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    return NextResponse.json({ id, status: "removed" });
  } catch (error) {
    console.error("Alert DELETE failed", error);
    return NextResponse.json({ error: "Could not remove this alert." }, { status: 503 });
  }
}
