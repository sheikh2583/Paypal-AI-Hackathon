import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuthReadiness, getDemoSession, getOwnerAccountExists } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  if (await getDemoSession()) redirect("/");
  const [ownerAccountExists] = await Promise.all([getOwnerAccountExists()]);
  const readiness = getAuthReadiness();
  return <LoginForm authConfigured={readiness.ready} ownerAccountExists={ownerAccountExists} testingSender={readiness.testingSender} emailVerified={(await searchParams).verified === "1"} />;
}
