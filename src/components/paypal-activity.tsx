import Link from "next/link";
import { CheckCircle2, CircleDollarSign } from "lucide-react";
import { paypalEventLabel } from "@/lib/labels";

export type PayPalActivityRow = {
  id: string;
  eventType: string;
  paypalInvoiceId: string | null;
  receivedAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export function PayPalActivity({ events }: { events: PayPalActivityRow[] }) {
  return <section aria-labelledby="paypal-activity-title" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
      <div><div className="flex items-center gap-2"><CircleDollarSign className="size-4 text-primary" /><h2 id="paypal-activity-title" className="font-semibold">PayPal activity</h2></div><p className="mt-1 text-xs text-muted-foreground">Events PayPal delivered to Chaser. Each one is signature-verified before it is stored.</p></div>
      <span className="text-xs text-muted-foreground">{events.length} recent {events.length === 1 ? "event" : "events"}</span>
    </div>
    {events.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">PayPal events appear here as soon as an invoice is created, sent, or paid.</p> :
      <ol className="divide-y">
        {events.map((event) => <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{paypalEventLabel(event.eventType)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 aria-hidden="true" className="size-3.5" />Signature verified</span>
              {event.invoiceId && event.invoiceNumber ? <Link href={`/invoices/${event.invoiceId}`} className="font-medium text-primary hover:underline">{event.invoiceNumber}</Link> : null}
              {event.paypalInvoiceId ? <span className="break-all">PayPal {event.paypalInvoiceId}</span> : null}
            </p>
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">{new Date(event.receivedAt).toLocaleString()}</time>
        </li>)}
      </ol>}
  </section>;
}
