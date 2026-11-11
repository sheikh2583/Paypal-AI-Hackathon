import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { db } from "@/lib/db/client";
import { getMessages, getPolicy, listApprovals, listPlansByInvoiceId, listRecentWebhookEvents } from "@/lib/db/queries";
import { getNow } from "@/lib/clock";
import { getDemoSession } from "@/lib/auth";
import { demoEnabled, demoResetAvailable } from "@/lib/demo";
import { getPayPalEnv } from "@/lib/env";
import { listInvoiceItems } from "@/lib/invoice-list";
import { reconcilePayPalOnRead } from "@/lib/paypal/poll";
import { PayPalActivity } from "@/components/paypal-activity";
import { AutopilotCard } from "@/components/autopilot-card";
import { InvoiceGridLoader } from "@/components/invoice-grid-loader";
import { getAutopilotStatus } from "@/lib/autopilot";
import { toInvoiceGridRow } from "@/lib/invoice-grid-rows";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);

export default async function DashboardPage() {
  if (await getDemoSession()) await reconcilePayPalOnRead();
  const now = getNow();
  const pending = listApprovals("PENDING", db);
  const allInvoices = listInvoiceItems(db, now, pending);
  const rows = allInvoices.filter(({ invoice }) => !invoice.parentInvoiceId && invoice.status !== "PAID" && invoice.status !== "CANCELLED")
    .sort((a, b) => (b.invoice.riskScore ?? 0) - (a.invoice.riskScore ?? 0));
  const openInvoices = allInvoices.filter(({ invoice }) => ["SENT", "OVERDUE", "PARTIALLY_PAID"].includes(invoice.status));
  const total = openInvoices.reduce((sum, { invoice }) => sum + Math.max(0, invoice.amountCents - invoice.paidCents), 0);
  const dana = rows.find(({ invoice }) => invoice.id === "invoice-dana-900");
  const danaPlan = dana ? listPlansByInvoiceId(dana.invoice.id, db)[0] : undefined;
  const danaDepositPaid = Boolean(danaPlan && allInvoices.some(({ invoice }) =>
    invoice.planId === danaPlan.id && invoice.installmentNo === 1 && invoice.status === "PAID"));
  const danaMessages = dana ? getMessages(dana.invoice.id, db) : [];
  const planIssued = danaPlan?.status === "ACTIVE" || danaPlan?.status === "RESOLVED";
  const danaProgress: 0 | 1 | 2 | 3 = planIssued ? 3 : danaPlan ? 2 : danaMessages.some((message) => message.direction === "agent_to_client") ? 1 : 0;
  const paypalMode = getPayPalEnv().mode;
  const webhookEvents = listRecentWebhookEvents(10, db);
  const policy = getPolicy(db);

  return (
    <div className="space-y-7">
      <PageHeader title={policy?.ownerName ? `Welcome, ${policy.ownerName.split(" ")[0]}` : "Collections dashboard"} description="Track overdue invoices and payment plans. Chaser only acts within your collection policy." />

      <section aria-label="Portfolio summary" className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={CircleDollarSign} label="Outstanding" value={money(total)} detail={`${openInvoices.length} open ${openInvoices.length === 1 ? "invoice" : "invoices"}`} />
        <SummaryCard icon={Clock3} label="Waiting on you" value={String(pending.length)} detail="Pending owner approvals" />
        <SummaryCard icon={ShieldCheck} label="Policy guardrails" value={policy ? "Active" : "Unavailable"} detail={policy ? `Min ${policy.minDepositPercent}% deposit · max ${policy.maxInstallments} installments · max ${policy.maxDiscountPercent}% discount` : "Owner policy is missing"} />
      </section>

      {demoEnabled() ? <DemoControls invoiceId={dana?.invoice.id} progressStep={danaProgress} stepComplete={planIssued} paymentComplete={danaDepositPaid} planComplete={danaPlan?.status === "RESOLVED"} paypalMode={paypalMode} showPlanLink showTimeControls showReset={demoResetAvailable(paypalMode)} /> : null}

      <AutopilotCard status={getAutopilotStatus(db)} />

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4">
          <div><h2 className="font-semibold">Invoices and payment plans</h2><p className="mt-1 text-sm text-muted-foreground">Open an invoice to review its conversation and payment activity.</p></div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{rows.length} invoices</span>
        </div>
        {rows.length === 0 ? <div className="p-8 text-center"><p className="font-medium">No demo invoices found</p><p className="mt-1 text-sm text-muted-foreground">Reset the demo to restore the seeded scenario.</p></div> : (
          <>
            <InvoiceGridLoader rows={rows.map(toInvoiceGridRow)} />
            <noscript><ul className="divide-y px-5 text-sm">{rows.map(({ invoice, client }) => <li key={invoice.id} className="py-3"><Link href={`/invoices/${invoice.id}`} className="font-medium text-primary underline">{client.name} · {invoice.number}</Link></li>)}</ul></noscript>
          </>
        )}
      </section>

      <PayPalActivity events={webhookEvents} />
      <p className="text-center text-xs text-muted-foreground">{paypalMode === "sandbox" ? "Invoicing and payments by the PayPal Sandbox. No real money moves." : "Simulated PayPal. No real money moves."}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof CircleDollarSign; label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><Icon className="size-4" /></span></div><p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>;
}
