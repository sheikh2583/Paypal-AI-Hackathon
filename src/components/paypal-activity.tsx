import Link from "next/link";
import { CheckCircle2, CircleDollarSign } from "lucide-react";

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
      <div><div className="flex items-center gap-2"><CircleDollarSign className="size-4 text-primary" /><h2 id="paypal-activity-title" className="font-semibold">PayPal activity</h2></div><p className="mt-1 text-xs text-muted-foreground">Events are stored after verification; Sandbox checks PayPal signatures, while mock checks a fixed local header.</p></div>
      <span className="text-xs text-muted-foreground">Latest {events.length} webhook events</span>
    </div>
    {events.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">PayPal webhook events accepted by the configured verifier will appear here after an invoice is created, sent, paid, or updated.</p> :
      <ol className="divide-y">
        {events.map((event) => <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
          <div className="min-w-0">
            <p className="break-all font-medium">{event.eventType}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>Event {event.id.slice(0, 8)}</span>
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 aria-hidden="true" className="size-3.5" />Verifier accepted</span>
              {event.paypalInvoiceId ? <span>PayPal invoice {event.paypalInvoiceId}</span> : null}
              {event.invoiceId && event.invoiceNumber ? <Link href={`/invoices/${event.invoiceId}`} className="text-primary hover:underline">{event.invoiceNumber}</Link> : null}
            </p>
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">{new Date(event.receivedAt).toLocaleString()}</time>
        </li>)}
      </ol>}
  </section>;
}
