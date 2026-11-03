// Mock mode only: stands in for PayPal's hosted invoice page.
// Clearly labelled MOCK — no PayPal branding or assets.
// Owner clicks "Pay now (sandbox mock)" → POSTs to /api/mock-paypal/pay.
import type { Metadata } from "next";
import { formatCents } from "@/lib/money";
import { db } from "@/lib/db/client";
import { getMockPaypalInvoice } from "@/lib/db/queries";
import MockPayNowButton from "./mock-pay-now-button";
import { getDemoSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Mock Invoice — Chaser" };

export default async function MockPayPalInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getDemoSession())) redirect("/login");
  const { id } = await params;
  const invoice = getMockPaypalInvoice(id, db);

  if (!invoice) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-8">
        <div className="w-full rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Invoice Not Found</p>
          <p className="mt-2 text-gray-600">
            No mock invoice with id <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{id}</code> was found.
          </p>
        </div>
      </main>
    );
  }

  const isPaid = invoice.status === "PAID";
  const isCancelled = invoice.status === "CANCELLED";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8">
      {/* MOCK badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400 bg-yellow-50 px-3 py-1">
        <span className="h-2 w-2 rounded-full bg-yellow-400" />
        <span className="text-xs font-bold uppercase tracking-widest text-yellow-700">
          Mock Sandbox Invoice
        </span>
      </div>

      {/* Invoice card */}
      <div className="w-full rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoice</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{invoice.number}</p>
        </div>

        <div className="divide-y divide-gray-100 px-6">
          <div className="flex items-center justify-between py-4">
            <span className="text-sm text-gray-500">Amount due</span>
            <span className="text-lg font-semibold text-gray-900">
              {formatCents(invoice.amountCents)}
            </span>
          </div>
          {invoice.paidCents > 0 && (
            <div className="flex items-center justify-between py-4">
              <span className="text-sm text-gray-500">Paid</span>
              <span className="text-sm font-medium text-green-600">
                {formatCents(invoice.paidCents)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between py-4">
            <span className="text-sm text-gray-500">Status</span>
            <StatusBadge status={invoice.status} />
          </div>
        </div>

        {/* Action */}
        <div className="px-6 pb-6 pt-2">
          {isPaid ? (
            <div className="rounded-lg bg-green-50 p-4 text-center">
              <p className="font-semibold text-green-700">✓ This invoice has been paid.</p>
            </div>
          ) : isCancelled ? (
            <div className="rounded-lg bg-gray-50 p-4 text-center">
              <p className="text-gray-500">This invoice has been cancelled.</p>
            </div>
          ) : (
            <MockPayNowButton paypalInvoiceId={id} />
          )}
        </div>
      </div>

      <p className="max-w-xs text-center text-xs text-gray-400">
        This is a simulated PayPal invoice page for local development and demo purposes only.
        No real payment is processed.
      </p>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-600" },
    SENT: { label: "Sent", className: "bg-blue-50 text-blue-700" },
    PAID: { label: "Paid", className: "bg-green-50 text-green-700" },
    PARTIALLY_PAID: { label: "Partially Paid", className: "bg-yellow-50 text-yellow-700" },
    CANCELLED: { label: "Cancelled", className: "bg-red-50 text-red-600" },
  };
  const badge = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  );
}
