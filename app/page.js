import Dashboard from "./dashboard";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Dashboard view="overview" userKey={user._id.toString()} userName={user.name} userEmail={user.email} />;
}
