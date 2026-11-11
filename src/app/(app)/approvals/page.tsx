import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock3, Inbox } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DemoControls } from "@/components/demo-controls";
import { db } from "@/lib/db/client";
import { getInvoice, listApprovals, listAudit } from "@/lib/db/queries";
import { demoEnabled } from "@/lib/demo";
import { getPayPalEnv } from "@/lib/env";
import { approvalKindLabels } from "@/lib/labels";
import { Mail } from "lucide-react";

function emailedApprovalIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of listAudit(undefined, db)) {
    if (entry.action !== "owner.notified" || !entry.ok) continue;
    const input = entry.input as { approvalId?: unknown } | null;
    const result = entry.result as { outcome?: unknown } | null;
    if (typeof input?.approvalId === "string" && result?.outcome === "sent") ids.add(input.approvalId);
  }
  return ids;
}

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvals = listApprovals(undefined, db);
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  const resolved = approvals.filter((approval) => approval.status !== "PENDING");
  const demo = demoEnabled();
  const emailed = emailedApprovalIds();
  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" description="Disputes and plans that need sign-off wait here for the owner." />
      {pending.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-6" /></span>
          <h2 className="mt-3 font-semibold">You’re all caught up</h2>
          <p className="mt-1 text-sm text-muted-foreground">When Chaser needs your sign-off, the reason and recommendation appear here.</p>
          {demo && getInvoice("invoice-priya-600", db) ? <Link href="/invoices/invoice-priya-600" className="mt-4 inline-block font-semibold text-primary underline">Open Priya’s demo invoice</Link> : null}
        </div>
      ) : (
        <section className="space-y-3" aria-label="Pending approvals">
          {pending.map((approval) => {
            const invoice = getInvoice(approval.invoiceId, db);
            return (
              <article key={approval.id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-800"><Inbox className="size-4" /></span>
                  <h2 className="font-semibold">{approvalKindLabels[approval.kind]}</h2>
                  <span className="ml-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Pending</span>
                </div>
                {emailed.has(approval.id) ? <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Mail aria-hidden="true" className="size-3.5" /> Chaser emailed you about this decision.</p> : null}
                <p className="text-sm leading-6">{approval.reason}</p>
                <p className="text-sm text-muted-foreground">Recommendation: {approval.recommendation}</p>
                {invoice ? <Link href={`/invoices/${invoice.id}`} className="inline-block text-sm font-semibold text-primary underline">Review {invoice.number}</Link> : null}
                {demo && invoice?.id === "invoice-priya-600" && approval.kind === "DISCOUNT_REQUEST" ? (
                  <DemoControls compact paypalMode={getPayPalEnv().mode} priyaAction={{ invoiceId: invoice.id, counter: true }} />
                ) : null}
              </article>
            );
          })}
        </section>
      )}
      {resolved.length > 0 ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-muted-foreground" /> Recently resolved</h2>
          <div className="space-y-2">
            {resolved.map((approval) => (
              <div key={approval.id} className="flex flex-wrap justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
                <span className="font-medium">{approvalKindLabels[approval.kind]}</span>
                <span className="text-muted-foreground">{approval.status.toLowerCase()} · {approval.ownerResponse ?? "No note"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
