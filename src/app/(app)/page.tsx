import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overdue invoices, payment risk and what Chaser will do next."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Coming soon"
        description="The invoice list, risk scores and “Run Chaser” controls land here."
      />
    </>
  );
}
