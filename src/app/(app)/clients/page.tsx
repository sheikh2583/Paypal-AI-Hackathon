import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientReliabilityView } from "@/components/client-reliability";
import { getAppEnv } from "@/lib/env";
import { loadClientReliability } from "@/lib/reliability-read";

export const metadata: Metadata = { title: "Client reliability" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const results = await loadClientReliability();
  if (!results) redirect("/login");
  return <ClientReliabilityView results={results} publicDemo={getAppEnv().demoPublic} />;
}
