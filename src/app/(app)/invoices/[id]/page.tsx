import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, MessageCircle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { ReliabilityBadge } from "@/components/client-reliability";
import { getNow } from "@/lib/clock";
import { demoEnabled } from "@/lib/demo";
import { getLlmEnv, getPayPalEnv } from "@/lib/env";
import { ClientReplyBox } from "@/components/client-reply-box";
import { computeRisk } from "@/lib/risk";
import { riskFeaturesForInvoice } from "@/lib/risk/service";
import { db } from "@/lib/db/client";
import { getClient, getInvoice, getMessages, getPlan, getPolicy, listApprovals, listAudit, listInvoicesByPlanId, listPlansByInvoiceId, listWebhookEventsForPayPalInvoice } from "@/lib/db/queries";
import { PayPalInvoicePanel } from "@/components/paypal-invoice-panel";
import { PayPalCopyId } from "@/components/paypal-copy-id";
import { PayPalPaidToast } from "@/components/paypal-paid-toast";
import { installmentCheck, lastPayPalSync } from "@/lib/paypal/display";
import { loadClientReliability } from "@/lib/reliability-read";
import { approvalKindLabels, chaseStateLabels, invoiceStatusLabels, llmProviderLabel, planStatusLabels } from "@/lib/labels";
import { messageSources } from "@/lib/message-source";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const responsivenessWords = { high: "Usually replies quickly", medium: "Replies within a few days", low: "Often slow to reply" } as const;

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = getInvoice(id, db);
  if (!invoice) notFound();
  const client = getClient(invoice.clientId, db);
  if (!client) notFound();
  const reliability = await loadClientReliability();
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
  // Labels each Chaser message with who wrote it: the live model or the script (D79).
  const sources = messageSources(invoiceAudit);
  const llmEnv = getLlmEnv();
  const liveAi = llmEnv.mode === "live";
  const providerName = llmProviderLabel(llmEnv);
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

  const firstName = client.name.split(" ")[0];
  const demo = demoEnabled();
  const priyaEscalated = invoice.id === "invoice-priya-600" && approvals.some(({ kind }) => kind === "DISCOUNT_REQUEST");
  // On the two story invoices the scripted steps come first; free text stays one click away.
  const guidedStoryOpen = demo && ((isDana && !planIssued) || showPriya);
  const dueLabel = new Date(invoice.dueAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All invoices</Link>
      <PageHeader title={client.name} description={`${invoice.number} · ${invoice.description}`} />

      {demo && isDana ? <div id="try-it" className="scroll-mt-6"><DemoControls
        invoiceId={invoice.id}
        title="Dana’s story: she asks to split her bill"
        description={`Click the button for each step. Dana’s lines are scripted so the story is repeatable. ${liveAi ? `Chaser’s answers are written live by ${providerName}, and your limits are checked in code.` : "Chaser’s answers follow a script here."} ${paypalMode === "sandbox" ? "The invoices are real PayPal Sandbox invoices paid with test money." : "PayPal is simulated here."}`}
        resultLink={planIssued ? { href: "#payment-plan", label: "See the payment plan" } : { href: "#conversation", label: "See it in the conversation" }}
        paymentInvoiceId={planIssued ? paymentTarget?.id : undefined}
        depositPayment={paymentTarget?.installmentNo === 1}
        paymentAmountCents={paymentTarget ? (paymentTarget.status === "PAID" ? paymentTarget.amountCents : paymentTarget.amountCents - paymentTarget.paidCents) : undefined}
        paymentComplete={deposit?.status === "PAID"}
        planComplete={planComplete}
        progressStep={progressStep}
        stepComplete={planIssued}
        paypalMode={paypalMode}
      /></div> : null}
      {demo && showPriya ? <div id="try-it" className="scroll-mt-6"><DemoControls
        priyaAction={{ invoiceId: invoice.id }}
        title="Priya’s story: she asks for 40% off"
        description={`Your limit is 5% off. Click to send Priya’s scripted request. ${liveAi ? `Chaser answers live with ${providerName}, ` : "Chaser answers, "}and the policy check hands the decision to you instead of letting it agree.`}
        paypalMode={paypalMode}
      /></div> : null}
      {demo && priyaEscalated ? <section id="try-it" className="scroll-mt-6 rounded-2xl border border-primary/25 bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Priya’s story: waiting for you</h2>
        <p className="mt-1 text-sm text-muted-foreground">Chaser didn’t agree to 40% off. It sent the request to Approvals with its reason and a suggested reply, and it won’t answer Priya until you decide.</p>
        <Link href="/approvals" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Answer Priya in Approvals</Link>
      </section> : null}
      {demo && !isDana && !showPriya && !priyaEscalated && payment && paypalMode === "mock" ? <DemoControls
        paymentInvoiceId={paymentTarget?.id}
        depositPayment={paymentTarget?.installmentNo === 1}
        paymentAmountCents={paymentTarget ? (paymentTarget.status === "PAID" ? paymentTarget.amountCents : paymentTarget.amountCents - paymentTarget.paidCents) : undefined}
        paypalMode={paypalMode}
        compact
      /> : null}

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">{amountLabel}</p><p className="mt-1 text-3xl font-semibold tracking-tight">{money(displayCents)}</p><p className="mt-2 text-sm text-muted-foreground">{amountDetail}</p></div>{superseded ? null : <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${invoice.status === "PAID" ? "bg-emerald-50 text-emerald-800" : closed ? "bg-secondary text-secondary-foreground" : "bg-amber-50 text-amber-800"}`}>{invoiceStatusLabels[invoice.status]}</span>}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm"><div><p className="text-xs text-muted-foreground">Stage</p><p className="mt-1 font-medium">{chaseStateLabels[invoice.chaseState]}</p></div>{!closed ? <div><p className="text-xs text-muted-foreground">Risk score</p><p className="mt-1 font-medium">{score} / 100</p></div> : null}</div>
          {!closed && invoice.riskExplanation ? <div className="mt-4 flex gap-2 rounded-xl bg-secondary/70 p-3 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><p>{invoice.riskExplanation}</p></div> : null}
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><FileText className="size-4 text-primary" /><h2 className="font-semibold">Client & invoice</h2></div><dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm"><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{client.name}</dd><dt className="text-muted-foreground">Business</dt><dd>{client.notes?.split(".")[0] ?? "Client"}</dd><dt className="text-muted-foreground">Invoice</dt><dd>{invoice.number}</dd><dt className="text-muted-foreground">Due date</dt><dd>{dueLabel}</dd><dt className="text-muted-foreground">Replies</dt><dd>{responsivenessWords[client.responsiveness]}</dd>{reliability ? <><dt className="text-muted-foreground">Pays on time</dt><dd><ReliabilityBadge
          result={reliability.find((result) => result.client.id === client.id)}
          rankedCount={reliability.filter((result) => result.rank !== null).length}
        /></dd></> : null}</dl></div>
      </section>

      <PayPalPaidToast invoiceId={invoice.id} />
      {invoice.paypalInvoiceId ? <PayPalInvoicePanel invoice={invoice} mode={paypalMode} sync={paypalSync} /> : null}

      {plan ? <PlanInstallments plan={plan} siblings={siblings} invoiceId={invoice.id} originalCents={originalCents} mode={paypalMode} /> : null}

      {approvals.length > 0 ? <section className="rounded-2xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">Owner approvals</h2><div className="mt-3 space-y-3">{approvals.map((approval) => <div key={approval.id} className="rounded-xl bg-secondary/60 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{approvalKindLabels[approval.kind]}</p><span className="text-xs text-muted-foreground">{approval.status.toLowerCase()}</span></div><p className="mt-2 text-sm">{approval.reason}</p><p className="mt-2 text-sm text-muted-foreground">Recommendation: {approval.recommendation}</p></div>)}</div></section> : null}

      <section id="conversation" className="scroll-mt-6 rounded-2xl border bg-card shadow-sm"><div className="border-b px-5 py-4"><div className="flex items-center gap-2"><MessageCircle className="size-4 text-primary" /><h2 className="font-semibold">Conversation</h2></div><p className="mt-1 text-sm text-muted-foreground">Messages between Chaser and {firstName}, plus every action Chaser took.</p></div>{messages.length === 0 && !paidEvent ? <p className="p-5 text-sm text-muted-foreground">No messages yet.</p> : <ol className="space-y-3 p-5">{messages.map((message) => <li key={message.id} className={`max-w-2xl rounded-xl p-4 ${message.direction === "agent_to_client" ? "bg-primary text-primary-foreground" : message.direction === "client_to_agent" ? "ml-auto bg-accent text-accent-foreground" : "mx-auto bg-secondary text-muted-foreground"}`}><p className="mb-1 text-xs font-semibold uppercase tracking-wide">{message.direction === "agent_to_client" ? (sources.get(message.id) === "live" ? `Chaser · written live by ${providerName}` : sources.get(message.id) === "scripted" ? "Chaser · scripted reply" : "Chaser") : message.direction === "client_to_agent" ? client.name : "Activity"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p></li>)}{paidEvent ? <li className="mx-auto max-w-2xl rounded-xl bg-emerald-50 p-4 text-emerald-800"><p className="font-semibold">Paid via PayPal</p><p className="mt-1 text-xs">Confirmed by a verified PayPal event</p><time className="mt-1 block text-xs" dateTime={paidEvent.processedAt ?? paidEvent.receivedAt}>{new Date(paidEvent.processedAt ?? paidEvent.receivedAt).toLocaleString()}</time></li> : null}</ol>}</section>

      {!closed ? <ClientReplyBox invoiceId={invoice.id} clientName={firstName} ownerName={getPolicy(db)?.ownerName?.split(" ")[0] ?? "the owner"} liveAi={getLlmEnv().mode === "live"} collapsed={guidedStoryOpen} /> : null}
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
  return <section id="payment-plan" className="scroll-mt-6 rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-semibold">Payment plan</h2><p className="mt-1 text-sm text-muted-foreground">{planStatusLabels[plan.status]} · {siblings.filter((row) => row.status === "PAID").length}/{plan.installments.length} installments paid · {plan.discountPercent}% discount</p></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{money(plan.totalCents)}</span></div>
    {check && originalCents !== undefined ? <p className={`px-5 py-3 text-sm font-medium ${check.matchesOriginal ? "text-emerald-700" : "text-amber-800"}`}>
      {check.matchesOriginal ? "Sum of installments = original invoice" : `Installments total ${money(check.sumCents)} · original invoice ${money(originalCents)} · ${plan.discountPercent > 0 ? "discounted plan" : "amounts differ"}`}
    </p> : null}
    <div className="divide-y">{plan.installments.map((installment) => {
      const row = siblings.find((sibling) => sibling.installmentNo === installment.no);
      const realLink = mode === "sandbox" && Boolean(row?.paypalInvoiceId && row.paypalInvoiceUrl && !row.paypalInvoiceId.startsWith("MOCK-"));
      return <div key={installment.no} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium">{row && row.id !== invoiceId ? <Link className="text-primary hover:underline" href={`/invoices/${row.id}`}>{installment.no === 1 ? "Deposit" : `Installment ${installment.no}`}</Link> : installment.no === 1 ? "Deposit" : `Installment ${installment.no}`}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Due {new Date(installment.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}{row ? <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">{invoiceStatusLabels[row.status]}</span> : <span>· {plan.status === "PENDING_APPROVAL" ? "Awaiting owner approval" : "Awaiting client acceptance"}</span>}</p>
          {row?.paypalInvoiceId ? <div className="mt-2"><PayPalCopyId id={row.paypalInvoiceId} /></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3"><span className="font-semibold tabular-nums">{money(installment.amountCents)}</span>
          {realLink && row?.paypalInvoiceUrl ? <a href={row.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open in PayPal <ExternalLink aria-hidden="true" className="size-3" /></a> : mode === "mock" && row?.paypalInvoiceId ? <span className="text-xs text-muted-foreground">Simulated invoice</span> : null}
        </div>
      </div>;
    })}</div>
  </section>;
}
