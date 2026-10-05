import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in — Aperture" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
