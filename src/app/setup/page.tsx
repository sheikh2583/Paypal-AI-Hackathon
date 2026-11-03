import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OwnerSetupForm } from "@/components/owner-setup-form";
import { getAuthReadiness, getOwnerAccountExists } from "@/lib/auth";
import { getAppEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Owner setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // In public demo mode there is no owner setup — go straight to the dashboard.
  if (getAppEnv().demoPublic) redirect("/");
  if (await getOwnerAccountExists()) redirect("/login");
  const readiness = getAuthReadiness();
  return <OwnerSetupForm configured={readiness.ready} testingSender={readiness.testingSender} />;
}
