import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, Clock3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StartHere, type StoryState } from "@/components/start-here";
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
  const paypalMode = getPayPalEnv().mode;
  const webhookEvents = listRecentWebhookEvents(10, db);
  const policy = getPolicy(db);
  const ownerFirstName = policy?.ownerName?.split(" ")[0] ?? "the owner";
  const demo = demoEnabled();

  // Story progress for the Start here card, read from the same records the invoice pages use.
  const danaInvoice = allInvoices.find(({ invoice }) => invoice.id === "invoice-dana-900")?.invoice;
  const danaPlan = danaInvoice ? listPlansByInvoiceId(danaInvoice.id, db)[0] : undefined;
  const danaPlanIssued = danaPlan?.status === "ACTIVE" || danaPlan?.status === "RESOLVED";
  const danaReminded = danaInvoice ? getMessages(danaInvoice.id, db).some((message) => message.direction === "agent_to_client") : false;
  const danaStep = danaPlanIssued ? 3 : danaPlan ? 2 : danaReminded ? 1 : 0;
  const danaState: StoryState = danaPlanIssued ? "done" : danaStep > 0 ? "in-progress" : "new";
  const priyaState: StoryState = listApprovals(undefined, db)
    .some((approval) => approval.invoiceId === "invoice-priya-600" && approval.kind === "DISCOUNT_REQUEST") ? "done" : "new";
  const clientCount = new Set(rows.map(({ client }) => client.id)).size;

  return (
    <div className="space-y-7">
      <PageHeader
        title={policy?.ownerName ? `Welcome, ${ownerFirstName}` : "Collections dashboard"}
        description="Your overdue invoices and payment plans. Chaser only acts inside the limits you set."
      />

      {demo ? <StartHere
        ownerFirstName={ownerFirstName}
        outstandingLabel={money(total)}
        clientCount={clientCount}
        maxDiscountPercent={policy?.maxDiscountPercent ?? 5}
        paypalMode={paypalMode}
        dana={{ state: danaState, step: danaStep }}
        priya={{ state: priyaState }}
        showReset={demoResetAvailable(paypalMode)}
      /> : null}

      <section aria-label="Portfolio summary" className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={CircleDollarSign} label="Outstanding" value={money(total)} detail={`${openInvoices.length} open ${openInvoices.length === 1 ? "invoice" : "invoices"}`} />
        <SummaryCard icon={Clock3} label="Waiting on you" value={String(pending.length)} detail={pending.length === 0 ? "Nothing needs your decision" : <Link href="/approvals" className="font-medium text-primary underline">Open Approvals</Link>} />
        <SummaryCard icon={ShieldCheck} label="Your limits" value={policy ? "Enforced" : "Unavailable"} detail={policy ? `At least ${policy.minDepositPercent}% up front · up to ${policy.maxInstallments} payments · at most ${policy.maxDiscountPercent}% off` : "Owner policy is missing"} />
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4">
          <div><h2 className="font-semibold">Invoices and payment plans</h2><p className="mt-1 text-sm text-muted-foreground">Click any invoice to see the conversation, the plan and its PayPal status.</p></div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{rows.length} invoices</span>
        </div>
        {rows.length === 0 ? <div className="p-8 text-center"><p className="font-medium">No invoices to chase</p><p className="mt-1 text-sm text-muted-foreground">{demo ? "Reset the demo from Demo tools to restore the five example invoices." : "New overdue invoices will appear here."}</p></div> : (
          <>
            <InvoiceGridLoader rows={rows.map(toInvoiceGridRow)} />
            <noscript><ul className="divide-y px-5 text-sm">{rows.map(({ invoice, client }) => <li key={invoice.id} className="py-3"><Link href={`/invoices/${invoice.id}`} className="font-medium text-primary underline">{client.name} · {invoice.number}</Link></li>)}</ul></noscript>
          </>
        )}
      </section>

      <AutopilotCard status={getAutopilotStatus(db)} />

      <PayPalActivity events={webhookEvents} />
      <p className="text-center text-xs text-muted-foreground">{paypalMode === "sandbox" ? "Invoicing and payments by the PayPal Sandbox. No real money moves." : "Simulated PayPal. No real money moves."}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }: { icon: typeof CircleDollarSign; label: string; value: string; detail: React.ReactNode }) {
  return <div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><Icon className="size-4" /></span></div><p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>;
}
