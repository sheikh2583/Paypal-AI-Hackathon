import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Anything outside your policy waits here for your decision."
      />
      <EmptyState
        icon={Inbox}
        title="Coming soon"
        description="Escalations from the agent, with its reasoning and a recommendation, will land here."
      />
    </>
  );
}
