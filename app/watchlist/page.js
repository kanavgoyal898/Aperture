import Dashboard from "../dashboard";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Watchlist — Aperture" };

export default async function WatchlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Dashboard view="watchlist" userKey={user._id.toString()} userName={user.name} userEmail={user.email} />;
}
