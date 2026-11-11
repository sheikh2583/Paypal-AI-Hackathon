import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, MessageCircle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { getNow } from "@/lib/clock";
import { demoEnabled } from "@/lib/demo";
import { getPayPalEnv } from "@/lib/env";
import { computeRisk } from "@/lib/risk";
import { riskFeaturesForInvoice } from "@/lib/risk/service";
import { db } from "@/lib/db/client";
import { getClient, getInvoice, getMessages, getPlan, listApprovals, listAudit, listInvoicesByPlanId, listPlansByInvoiceId, listWebhookEventsForPayPalInvoice } from "@/lib/db/queries";
import { PayPalInvoicePanel } from "@/components/paypal-invoice-panel";
import { PayPalCopyId } from "@/components/paypal-copy-id";
import { PayPalPaidToast } from "@/components/paypal-paid-toast";
import { installmentCheck, lastPayPalSync } from "@/lib/paypal/display";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = getInvoice(id, db);
  if (!invoice) notFound();
  const client = getClient(invoice.clientId, db);
  if (!client) notFound();
  const messages = getMessages(id, db);
  const plan = invoice.planId ? getPlan(invoice.planId, db) : listPlansByInvoiceId(id, db)[0] ?? null;
  const originalCents = plan && plan.invoiceId !== id ? getInvoice(plan.invoiceId, db)?.amountCents : invoice.amountCents;
  const approvals = listApprovals(undefined, db).filter((approval) => approval.invoiceId === id);
  const siblings = plan ? listInvoicesByPlanId(plan.id, db).filter((row) => row.parentInvoiceId === plan.invoiceId) : [];
  const deposit = siblings.find((row) => row.installmentNo === 1);
  const isDana = invoice.id === "invoice-dana-900";
  const showPriya = invoice.id === "invoice-priya-600" && !approvals.some(({ kind }) => kind === "DISCOUNT_REQUEST");
  const candidate = isDana && deposit ? deposit : invoice;
  const payment = candidate.paypalInvoiceId && ["SENT", "OVERDUE", "PARTIALLY_PAID"].includes(candidate.status) ? candidate : undefined;
  const paymentTarget = payment ?? (isDana && deposit?.status === "PAID" ? deposit : undefined);
  const planIssued = plan?.status === "ACTIVE" || plan?.status === "RESOLVED";
  const progressStep: 0 | 1 | 2 | 3 = planIssued ? 3 : plan ? 2 : messages.some((message) => message.direction === "agent_to_client") ? 1 : 0;
  const paypalMode = getPayPalEnv().mode;
  const invoiceAudit = listAudit(invoice.id, db);
  const paypalEvents = invoice.paypalInvoiceId ? listWebhookEventsForPayPalInvoice(invoice.paypalInvoiceId, db) : [];
  const paypalSync = lastPayPalSync(invoiceAudit, paypalEvents);
  const paidEvent = paypalMode === "sandbox" && invoice.status === "PAID"
    ? paypalEvents.find((event) => event.processedAt && event.eventType === "INVOICING.INVOICE.PAID")
    : undefined;
  const overdueDays = Math.max(0, Math.floor((getNow().getTime() - Date.parse(invoice.dueAt)) / 86_400_000));
  const score = invoice.riskScore ?? computeRisk(riskFeaturesForInvoice(invoice, db, getNow())).score;
  const superseded = invoice.status === "SUPERSEDED";
  const planComplete = plan?.status === "RESOLVED";
  const closed = invoice.status === "PAID" || invoice.status === "CANCELLED" || (superseded && planComplete);
  const amountLabel = superseded ? "Original invoice amount" : invoice.status === "CANCELLED" ? "Cancelled invoice amount" : "Balance due";
  const displayCents = superseded || invoice.status === "CANCELLED" ? invoice.amountCents : Math.max(0, invoice.amountCents - invoice.paidCents);
  const amountDetail = superseded
    ? planComplete ? "The installment plan was paid in full." : "Replaced by the installment invoices below."
    : `Original amount ${money(invoice.amountCents)}${!closed && overdueDays > 0 ? ` · ${overdueDays} ${overdueDays === 1 ? "day" : "days"} overdue` : ""}`;

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All invoices</Link>
      <PageHeader title={invoice.number} description={`${client.name} · ${invoice.description}`} />

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{amountLabel}</p><p className="mt-1 text-3xl font-semibold tracking-tight">{money(displayCents)}</p><p className="mt-2 text-sm text-muted-foreground">{amountDetail}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${invoice.status === "PAID" ? "bg-emerald-50 text-emerald-800" : closed ? "bg-secondary text-secondary-foreground" : "bg-amber-50 text-amber-800"}`}>{invoice.status.replaceAll("_", " ")}</span></div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm"><div><p className="text-xs text-muted-foreground">Chase state</p><p className="mt-1 font-medium">{invoice.chaseState.replaceAll("_", " ").toLowerCase()}</p></div>{!closed ? <div><p className="text-xs text-muted-foreground">Risk score</p><p className="mt-1 font-medium">{score} / 100</p></div> : null}</div>
          {!closed && invoice.riskExplanation ? <div className="mt-4 flex gap-2 rounded-xl bg-secondary/70 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><p>{invoice.riskExplanation}</p></div> : null}
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><FileText className="size-4 text-primary" /><h2 className="font-semibold">Client & invoice</h2></div><dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm"><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{client.name}</dd><dt className="text-muted-foreground">Business</dt><dd>{client.notes?.split(".")[0] ?? "Client"}</dd><dt className="text-muted-foreground">Invoice</dt><dd>{invoice.number}</dd><dt className="text-muted-foreground">Due date</dt><dd>{new Date(invoice.dueAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</dd><dt className="text-muted-foreground">Responsiveness</dt><dd className="capitalize">{client.responsiveness}</dd></dl></div>
      </section>

      <PayPalPaidToast invoiceId={invoice.id} />
      <PayPalInvoicePanel invoice={invoice} mode={paypalMode} sync={paypalSync} />
      {demoEnabled() && (isDana || showPriya || payment && paypalMode === "mock") ? <DemoControls
        invoiceId={isDana ? invoice.id : undefined}
        priyaAction={showPriya ? { invoiceId: invoice.id } : undefined}
        paymentInvoiceId={paymentTarget?.id}
        depositPayment={paymentTarget?.installmentNo === 1}
        paymentAmountCents={paymentTarget ? (paymentTarget.status === "PAID" ? paymentTarget.amountCents : paymentTarget.amountCents - paymentTarget.paidCents) : undefined}
        paymentComplete={isDana && deposit?.status === "PAID"}
        planComplete={isDana && planComplete}
        progressStep={progressStep}
        stepComplete={isDana && planIssued}
        paypalMode={paypalMode}
        compact={!isDana}
      /> : null}

      {plan ? <PlanInstallments plan={plan} siblings={siblings} invoiceId={invoice.id} originalCents={originalCents} mode={paypalMode} /> : null}

      {approvals.length > 0 ? <section className="rounded-2xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">Owner approvals</h2><div className="mt-3 space-y-3">{approvals.map((approval) => <div key={approval.id} className="rounded-xl bg-secondary/60 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{approval.kind.replaceAll("_", " ")}</p><span className="text-xs text-muted-foreground">{approval.status.toLowerCase()}</span></div><p className="mt-2 text-sm">{approval.reason}</p><p className="mt-2 text-sm text-muted-foreground">Recommendation: {approval.recommendation}</p></div>)}</div></section> : null}

      <section className="rounded-2xl border bg-card shadow-sm"><div className="border-b px-5 py-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><h2 className="font-semibold">Conversation & activity</h2></div><p className="mt-1 text-sm text-muted-foreground">Client replies are simulated for this demo; every agent action is audited.</p></div>{messages.length === 0 && !paidEvent ? <p className="p-5 text-sm text-muted-foreground">No conversation yet. Run a guided step to see the simulated messages here.</p> : <ol className="space-y-3 p-5">{messages.map((message) => <li key={message.id} className={`max-w-2xl rounded-xl p-4 ${message.direction === "agent_to_client" ? "bg-primary text-primary-foreground" : message.direction === "client_to_agent" ? "ml-auto bg-accent text-accent-foreground" : "mx-auto bg-secondary text-muted-foreground"}`}><p className="mb-1 text-xs font-semibold uppercase tracking-wide">{message.direction === "agent_to_client" ? "Chaser · simulated" : message.direction === "client_to_agent" ? client.name : "Activity"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p></li>)}{paidEvent ? <li className="mx-auto max-w-2xl rounded-xl bg-emerald-50 p-4 text-emerald-800"><p className="font-semibold">Paid via PayPal</p><p className="mt-1 text-xs">Event {paidEvent.id}</p><time className="mt-1 block text-xs" dateTime={paidEvent.processedAt ?? paidEvent.receivedAt}>{new Date(paidEvent.processedAt ?? paidEvent.receivedAt).toLocaleString()}</time></li> : null}</ol>}</section>
    </div>
  );
}

function PlanInstallments({ plan, siblings, invoiceId, originalCents, mode }: {
  plan: NonNullable<ReturnType<typeof getPlan>>;
  siblings: ReturnType<typeof listInvoicesByPlanId>;
  invoiceId: string;
  originalCents?: number;
  mode: "mock" | "sandbox";
}) {
  const check = originalCents === undefined ? null : installmentCheck(plan.installments, originalCents);
  return <section className="rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-semibold">Payment plan</h2><p className="mt-1 text-sm text-muted-foreground">{plan.status.replaceAll("_", " ")} · {siblings.filter((row) => row.status === "PAID").length}/{plan.installments.length} installments paid · {plan.discountPercent}% discount</p></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{money(plan.totalCents)}</span></div>
    {check && originalCents !== undefined ? <p className={`px-5 py-3 text-sm font-medium ${check.matchesOriginal ? "text-emerald-700" : "text-amber-800"}`}>
      {check.matchesOriginal ? "Sum of installments = original invoice" : `Installments total ${money(check.sumCents)} · original invoice ${money(originalCents)} · ${plan.discountPercent > 0 ? "discounted plan" : "amounts differ"}`}
    </p> : null}
    <div className="divide-y">{plan.installments.map((installment) => {
      const row = siblings.find((sibling) => sibling.installmentNo === installment.no);
      const realLink = mode === "sandbox" && Boolean(row?.paypalInvoiceId && row.paypalInvoiceUrl && !row.paypalInvoiceId.startsWith("MOCK-"));
      return <div key={installment.no} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium">{row && row.id !== invoiceId ? <Link className="text-primary hover:underline" href={`/invoices/${row.id}`}>{installment.no === 1 ? "Deposit" : `Installment ${installment.no}`}</Link> : installment.no === 1 ? "Deposit" : `Installment ${installment.no}`}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Due {new Date(installment.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{row ? <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{row.status.replaceAll("_", " ")}</span> : <span>· {plan.status === "PENDING_APPROVAL" ? "Awaiting owner approval" : "Awaiting client acceptance"}</span>}</p>
          {row?.paypalInvoiceId ? <div className="mt-2"><PayPalCopyId id={row.paypalInvoiceId} /></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3"><span className="font-semibold tabular-nums">{money(installment.amountCents)}</span>
          {realLink && row?.paypalInvoiceUrl ? <a href={row.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open in PayPal <ExternalLink aria-hidden="true" className="size-3" /></a> : mode === "mock" && row?.paypalInvoiceId ? <span className="text-xs text-muted-foreground">Simulated invoice</span> : null}
        </div>
      </div>;
    })}</div>
  </section>;
}
