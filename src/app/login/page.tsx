import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuthReadiness, getDemoSession, getOwnerAccountExists } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getDemoSession()) redirect("/");
  const [ownerAccountExists] = await Promise.all([getOwnerAccountExists()]);
  return <LoginForm authConfigured={getAuthReadiness().ready} ownerAccountExists={ownerAccountExists} />;
}
