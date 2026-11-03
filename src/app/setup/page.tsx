import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OwnerSetupForm } from "@/components/owner-setup-form";
import { getAuthReadiness, getOwnerAccountExists } from "@/lib/auth";

export const metadata: Metadata = { title: "Owner setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await getOwnerAccountExists()) redirect("/login");
  const readiness = getAuthReadiness();
  return <OwnerSetupForm configured={readiness.ready} testingSender={readiness.testingSender} />;
}
