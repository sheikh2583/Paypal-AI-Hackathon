import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleDollarSign, ExternalLink, MessageCircle } from "lucide-react";
import { ClientReplyForm, ClientSignOut } from "@/components/client-portal";
import { getClientSession, loadClientPortal, type ClientPortalInvoice } from "@/lib/client-access";
import { getNow } from "@/lib/clock";
import { db } from "@/lib/db/client";
import { getPolicy } from "@/lib/db/queries";
import { getPayPalEnv } from "@/lib/env";
import { invoiceStatusLabels } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { InvoiceRow } from "@/lib/types";

export const metadata: Metadata = { title: "Your invoices" };
export const dynamic = "force-dynamic";

const OPEN = new Set(["SENT", "OVERDUE", "PARTIALLY_PAID"]);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A client's own view (D77): their invoices, plan, pay links and conversation, nothing else. */
export default async function ClientPortalPage() {
  const session = await getClientSession();
  if (!session) redirect("/client/login");
  const portal = loadClientPortal(session.clientId, db);
  if (!portal) redirect("/client/login?reason=not-client");
  const policy = getPolicy(db);
  const ownerName = policy?.ownerName?.split(" ")[0] ?? "your freelancer";
  const business = policy?.businessName ?? "your freelancer";
  const sandbox = getPayPalEnv().mode === "sandbox";
  const now = getNow();

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><CircleDollarSign className="size-5" aria-hidden="true" /></span><div><p className="font-semibold">Invoices from {business}</p><p className="text-xs text-muted-foreground">Signed in as {session.email}</p></div></div>
          <ClientSignOut />
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi {portal.client.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here is what you owe {business}, any payment plan you agreed, and your messages with Chaser, the assistant {ownerName} uses to follow up on invoices.{sandbox ? " Payments go through PayPal Sandbox with test money." : " PayPal is simulated in this demo."}</p>
        </div>
        {portal.invoices.length === 0 ? <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">You have no invoices right now.</p> : null}
        {portal.invoices.map((entry) => <InvoiceCard key={entry.invoice.id} entry={entry} ownerName={ownerName} sandbox={sandbox} now={now} />)}
        <p className="text-center text-xs text-muted-foreground">Fictional invoices for the PayPal AI Hackathon demo. No real money moves.</p>
      </div>
    </main>
  );
}

function PayLink({ invoice, sandbox }: { invoice: InvoiceRow; sandbox: boolean }) {
  if (!invoice.paypalInvoiceUrl || !OPEN.has(invoice.status)) return null;
  const real = sandbox && !invoice.paypalInvoiceId?.startsWith("MOCK-");
  return <a href={invoice.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">{real ? "Pay in PayPal" : "Pay (simulated)"} <ExternalLink className="size-3.5" aria-hidden="true" /></a>;
}

function InvoiceCard({ entry, ownerName, sandbox, now }: { entry: ClientPortalInvoice; ownerName: string; sandbox: boolean; now: Date }) {
  const { invoice, installments, plan, messages } = entry;
  const remaining = Math.max(0, invoice.amountCents - invoice.paidCents);
  const daysLate = Math.max(0, Math.floor((now.getTime() - Date.parse(invoice.dueAt)) / 86_400_000));
  const open = OPEN.has(invoice.status);
  return (
    <section aria-label={`Invoice ${invoice.number}`} className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div><h2 className="font-semibold">{invoice.description}</h2><p className="mt-1 text-sm text-muted-foreground">Invoice {invoice.number} · due {dateLabel(invoice.dueAt)}{open && daysLate > 0 ? ` · ${daysLate} days overdue` : ""}</p></div>
        <div className="text-right"><p className="text-xl font-semibold tabular-nums">{formatCents(invoice.status === "SUPERSEDED" ? invoice.amountCents : remaining)}</p><p className="text-xs text-muted-foreground">{invoice.status === "SUPERSEDED" ? "Split into the payment plan below" : invoiceStatusLabels[invoice.status]}</p></div>
      </div>
      {open && !installments.length ? <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><span className="text-muted-foreground">{invoice.paypalInvoiceUrl ? "Pay the full amount through PayPal, or reply below to discuss it." : `${ownerName} will send a PayPal link. Reply below if you need a payment plan.`}</span><PayLink invoice={invoice} sandbox={sandbox} /></div> : null}
      {installments.length ? <div className="px-5 py-3">
        <p className="text-sm font-medium">Your payment plan{plan ? ` · ${plan.installments.length} payments${plan.discountPercent ? ` · ${plan.discountPercent}% off` : ""}` : ""}</p>
        <ul className="mt-2 divide-y rounded-xl border">{installments.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div><p className="font-medium">{row.installmentNo === 1 ? "Deposit" : `Payment ${row.installmentNo}`} · {formatCents(row.amountCents)}</p><p className="text-xs text-muted-foreground">Due {dateLabel(row.dueAt)} · {invoiceStatusLabels[row.status]}</p></div>
          <PayLink invoice={row} sandbox={sandbox} />
        </li>)}</ul>
      </div> : null}
      <div className="border-t px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-primary" aria-hidden="true" /> Messages</p>
        {messages.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No messages yet.</p> : <ol className="mt-3 space-y-3">{messages.map((message) => <li key={message.id} className={`max-w-2xl rounded-xl p-3 text-sm ${message.direction === "client_to_agent" ? "ml-auto bg-accent text-accent-foreground" : "bg-secondary"}`}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide">{message.direction === "client_to_agent" ? "You" : `Chaser for ${ownerName}`}</p>
          <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
        </li>)}</ol>}
        {open ? <ClientReplyForm invoiceId={invoice.id} ownerName={ownerName} /> : null}
      </div>
    </section>
  );
}
