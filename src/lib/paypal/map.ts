// Mapping between our internal types and PayPal's Invoicing v2 request/response shapes.
// Money conversion reuses centsToDecimalString / decimalStringToCents from money.ts
// (never duplicated here — hard rule 1).
import { centsToDecimalString, decimalStringToCents } from "../money";
import type { Cents, CreateInvoiceInput, PayPalInvoice } from "../types";

// ---------------------------------------------------------------------------
// PayPal Invoicing v2 raw shapes (only the fields we read/write)
// ---------------------------------------------------------------------------

export interface PayPalInvoiceDetailItem {
  name: string;
  quantity: string;
  unit_amount: { currency_code: string; value: string };
}

export interface PayPalCreateInvoiceBody {
  detail: {
    invoice_number: string;
    invoice_date: string; // YYYY-MM-DD
    currency_code: string;
    note?: string;
    payment_term: { term_type: "DUE_ON_DATE_SPECIFIED"; due_date: string };
  };
  invoicer: {
    email_address: string;
  };
  primary_recipients: Array<{
    billing_info: {
      name: { given_name: string; surname: string };
      email_address: string;
    };
  }>;
  items: PayPalInvoiceDetailItem[];
}

/** PayPal amount object used in GET responses. */
export interface PayPalAmountObject {
  currency_code: string;
  value: string;
}

/** PayPal GET /v2/invoicing/invoices/{id} response (subset of fields we use). */
export interface PayPalGetInvoiceResponse {
  id: string;
  status: string; // DRAFT | SENT | PAID | PARTIALLY_PAID | CANCELLED | MARKED_AS_PAID | etc.
  detail: {
    invoice_number: string;
    metadata?: {
      recipient_view_url?: string;
    };
  };
  amount?: {
    breakdown?: {
      item_total?: PayPalAmountObject;
    };
    value?: string;
    currency_code?: string;
  };
  payments?: {
    paid_amount?: PayPalAmountObject;
  };
  refunds?: { refund_amount?: PayPalAmountObject };
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

/**
 * Extracts the total invoice amount in cents from a PayPal GET response.
 * PayPal returns the amount at `amount.breakdown.item_total.value` for
 * item-based invoices, or `amount.value` as a fallback.
 */
export function extractAmountCents(response: PayPalGetInvoiceResponse): Cents {
  const raw =
    response.amount?.breakdown?.item_total?.value ??
    response.amount?.value;
  if (!raw) return 0;
  return decimalStringToCents(raw);
}

/**
 * Extracts the paid amount in cents from a PayPal GET response.
 * Returns 0 when no payment exists yet.
 */
export function extractPaidCents(response: PayPalGetInvoiceResponse): Cents {
  const status = response.status.toUpperCase();
  if (status === "REFUNDED" || status === "MARKED_AS_REFUNDED") return 0;
  const paid = response.payments?.paid_amount?.value;
  const refunded = response.refunds?.refund_amount?.value;
  return Math.max(0, (paid ? decimalStringToCents(paid) : 0) - (refunded ? decimalStringToCents(refunded) : 0));
}

/**
 * Maps a PayPal status string to our internal PayPalInvoice status union.
 * PayPal v2 statuses we may receive: DRAFT, SENT, SCHEDULED, UNPAID,
 * PAID, PARTIALLY_PAID, MARKED_AS_PAID, MARKED_AS_REFUNDED, CANCELLED, REFUNDED.
 * We collapse SCHEDULED/UNPAID → SENT and unknown → UNKNOWN.
 */
export function mapPayPalStatus(
  paypalStatus: string,
): PayPalInvoice["status"] {
  const s = paypalStatus.toUpperCase();
  if (s === "DRAFT") return "DRAFT";
  if (s === "SENT" || s === "UNPAID" || s === "SCHEDULED") return "SENT";
  if (s === "PAID" || s === "MARKED_AS_PAID") return "PAID";
  if (s === "PARTIALLY_PAID" || s === "PARTIALLY_REFUNDED") return "PARTIALLY_PAID";
  if (s === "CANCELLED" || s === "REFUNDED" || s === "MARKED_AS_REFUNDED") return "CANCELLED";
  return "UNKNOWN";
}

/**
 * Maps a PayPal GET response to our internal PayPalInvoice shape.
 */
export function mapGetResponseToInvoice(
  response: PayPalGetInvoiceResponse,
): PayPalInvoice {
  return {
    paypalInvoiceId: response.id,
    number: response.detail.invoice_number,
    status: mapPayPalStatus(response.status),
    amountCents: extractAmountCents(response),
    paidCents: extractPaidCents(response),
    recipientViewUrl: response.detail.metadata?.recipient_view_url,
  };
}

/**
 * PayPal reads invoice_date in the merchant account's own time zone and holds a
 * future-dated invoice as SCHEDULED: unpayable, and refused by the cancel call.
 * The UTC date runs up to a day ahead of the Americas, so the date is taken in
 * UTC−12, which is never later than the merchant's local date anywhere.
 */
export function invoiceDateForPayPal(now: Date = new Date()): string {
  return new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Maps our CreateInvoiceInput to the PayPal Invoicing v2 request body.
 * Amount is a single line-item at quantity 1.
 * Uses DUE_ON_DATE_SPECIFIED with the invoice's dueAt date.
 * `merchantEmail` is required by PayPal — callers must supply it from env.
 */
export function buildCreateInvoiceBody(
  input: CreateInvoiceInput,
  merchantEmail: string,
): PayPalCreateInvoiceBody {
  // Split client name into given/surname (best-effort; surname = last word)
  const nameParts = input.clientName.trim().split(/\s+/);
  const surname = nameParts.length > 1 ? (nameParts.pop() ?? "") : "";
  const givenName = nameParts.join(" ") || input.clientName;

  return {
    detail: {
      invoice_number: input.number,
      invoice_date: invoiceDateForPayPal(),
      currency_code: "USD",
      ...(input.note ? { note: input.note } : {}),
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: input.dueAt.slice(0, 10), // ISO date portion only
      },
    },
    invoicer: {
      email_address: merchantEmail,
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: givenName, surname },
          email_address: input.clientEmail,
        },
      },
    ],
    items: [
      {
        name: input.description,
        quantity: "1",
        unit_amount: {
          currency_code: "USD",
          value: centsToDecimalString(input.amountCents),
        },
      },
    ],
  };
}

