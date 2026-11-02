import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Mock PayPal invoice" };

// Mock mode only (PAYPAL_MODE=mock): stands in for PayPal's hosted invoice page.
// Owner A builds the real page in prompt 03.
export default async function MockPayPalInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-4">
      <EmptyState
        className="w-full"
        icon={Receipt}
        title="Coming soon"
        description={`The simulated PayPal invoice page for “${id}” will live here (mock mode only).`}
      />
    </main>
  );
}
