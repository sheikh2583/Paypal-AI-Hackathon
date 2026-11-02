import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Policy" };

export default function PolicyPage() {
  return (
    <>
      <PageHeader
        title="Policy"
        description="The limits Chaser must stay within when it negotiates on your behalf."
      />
      <EmptyState
        icon={SlidersHorizontal}
        title="Coming soon"
        description="Deposit, installment, discount and approval-threshold settings will be editable here."
      />
    </>
  );
}
