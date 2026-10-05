import Dashboard from "../dashboard";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Heat Map — Aperture" };

export default async function HeatmapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Dashboard view="heatmap" userKey={user._id.toString()} userName={user.name} userEmail={user.email} />;
}
