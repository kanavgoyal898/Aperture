import Dashboard from "../dashboard";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Focus — Aperture" };

export default async function FocusPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const ticker = Array.isArray(query.ticker) ? query.ticker[0] : query.ticker;
  const initialTicker = /^[A-Z0-9.^=-]{1,12}$/i.test(String(ticker || "")) ? String(ticker).toUpperCase() : "";
  return <Dashboard view="focus" initialTicker={initialTicker} userKey={user._id.toString()} userName={user.name} userEmail={user.email} />;
}
