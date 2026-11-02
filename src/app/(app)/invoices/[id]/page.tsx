import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Invoice"
        description="Conversation, payment plan and audit trail for a single invoice."
      />
      <EmptyState
        icon={MessagesSquare}
        title="Coming soon"
        description={`Invoice detail and the simulated client chat for “${id}” will appear here.`}
      />
    </>
  );
}
