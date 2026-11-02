import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every action the agent and you have taken, newest first."
      />
      <EmptyState
        icon={ScrollText}
        title="Coming soon"
        description="Each tool call, policy decision and owner action will be recorded and searchable here."
      />
    </>
  );
}
