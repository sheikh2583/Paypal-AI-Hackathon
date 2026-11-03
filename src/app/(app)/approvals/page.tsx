import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock3, Inbox } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";
import { getInvoice, listApprovals } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvals = listApprovals(undefined, db);
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  const resolved = approvals.filter((approval) => approval.status !== "PENDING");
  return <div className="space-y-6">
    <PageHeader title="Approvals" description="Plans outside the auto-approval threshold wait here for your decision." />
    {pending.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-center shadow-sm"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-6" /></span><h2 className="mt-3 font-semibold">You’re all caught up</h2><p className="mt-1 text-sm text-muted-foreground">When Chaser needs your sign-off, the reason and recommendation will appear here.</p></div> : <section className="space-y-3">{pending.map((approval) => { const invoice = getInvoice(approval.invoiceId, db); return <article key={approval.id} className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-800"><Inbox className="size-4" /></span><h2 className="font-semibold">{approval.kind.replaceAll("_", " ").toLowerCase()}</h2></div><p className="mt-3 text-sm leading-6">{approval.reason}</p><p className="mt-2 text-sm text-muted-foreground">Recommendation: {approval.recommendation}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Pending</span></div>{invoice ? <Link href={`/invoices/${invoice.id}`} className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Review {invoice.number} for {invoice.amountCents / 100} dollars →</Link> : null}</article>; })}</section>}
    {resolved.length ? <section><div className="mb-3 flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" /><h2 className="font-semibold">Recently resolved</h2></div><div className="space-y-2">{resolved.map((approval) => <div key={approval.id} className="flex flex-wrap justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm"><span className="font-medium">{approval.kind.replaceAll("_", " ").toLowerCase()}</span><span className="text-muted-foreground">{approval.status.toLowerCase()} · {approval.ownerResponse ?? "No note"}</span></div>)}</div></section> : null}
  </div>;
}
