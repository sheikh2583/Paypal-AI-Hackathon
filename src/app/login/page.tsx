import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuthReadiness, getDemoSession, getOwnerAccountExists } from "@/lib/auth";
import { getAppEnv } from "@/lib/env";
import { DEMO_OWNER_DISPLAY } from "@/lib/demo-accounts";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  // The public demo skips sign-in, but judges can still see the owner sign-in a real workspace uses.
  // The form is shown disabled so nobody can trigger codes or reset emails to the owner's inbox.
  if (getAppEnv().demoPublic) return <LoginForm authConfigured ownerAccountExists testingSender={false} emailVerified={false} previewOnly demoDisplay={DEMO_OWNER_DISPLAY} />;
  if (await getDemoSession()) redirect("/");
  const [ownerAccountExists] = await Promise.all([getOwnerAccountExists()]);
  const readiness = getAuthReadiness();
  return <LoginForm authConfigured={readiness.ready} ownerAccountExists={ownerAccountExists} testingSender={readiness.testingSender} emailVerified={(await searchParams).verified === "1"} />;
}
