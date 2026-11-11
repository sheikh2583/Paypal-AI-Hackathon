import { ExternalLink } from "lucide-react";
import type { InvoiceRow } from "@/lib/types";
import type { PayPalDisplayMode, PayPalSync } from "@/lib/paypal/display";
import { invoiceStatusLabels } from "@/lib/labels";
import { PayPalCopyId } from "./paypal-copy-id";

const statusTone: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-blue-50 text-blue-700",
  OVERDUE: "bg-amber-50 text-amber-800",
  PARTIALLY_PAID: "bg-violet-50 text-violet-700",
  PAID: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  SUPERSEDED: "bg-slate-100 text-slate-600",
};

export function PayPalInvoicePanel({ invoice, mode, sync }: {
  invoice: InvoiceRow;
  mode: PayPalDisplayMode;
  sync: PayPalSync;
}) {
  const isRealSandbox = mode === "sandbox" && !invoice.paypalInvoiceId?.startsWith("MOCK-");
  return <section aria-labelledby="paypal-invoice-title" className="rounded-2xl border bg-card p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="paypal-invoice-title" className="font-semibold">PayPal</h2><p className="mt-1 text-sm text-muted-foreground">{!invoice.paypalInvoiceId ? "Installment plans are issued through PayPal Invoicing; this record is not linked to a PayPal invoice." : isRealSandbox ? "Issued through PayPal Invoicing (Sandbox, test money only)" : "Simulated invoice · no real money moves"}</p></div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[invoice.status] ?? "bg-secondary text-secondary-foreground"}`}>{invoiceStatusLabels[invoice.status]}</span>
    </div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[150px_1fr]">
      <dt className="text-muted-foreground">PayPal invoice ID</dt><dd>{invoice.paypalInvoiceId ? <PayPalCopyId id={invoice.paypalInvoiceId} /> : <span className="text-muted-foreground">Not issued yet</span>}</dd>
      <dt className="text-muted-foreground">Status</dt><dd>{invoiceStatusLabels[invoice.status]}</dd>
      <dt className="text-muted-foreground">Last update from PayPal</dt><dd>{sync ? <><time dateTime={sync.at}>{new Date(sync.at).toLocaleString()}</time><span className="text-muted-foreground"> · {sync.source === "webhook" ? "webhook" : "status check"}</span></> : <span className="text-muted-foreground">No update received yet</span>}</dd>
      {isRealSandbox && invoice.paypalInvoiceUrl && invoice.paypalInvoiceId ? <><dt className="text-muted-foreground">Payer link</dt><dd><a href={invoice.paypalInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Open in PayPal <ExternalLink aria-hidden="true" className="size-3.5" /></a></dd></> : null}
    </dl>
  </section>;
}
