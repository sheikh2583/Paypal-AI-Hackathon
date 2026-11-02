import { describe, expect, it } from "vitest";
import { decimalStringToCents, centsToDecimalString } from "../money";
import {
  buildCreateInvoiceBody,
  extractAmountCents,
  extractPaidCents,
  mapGetResponseToInvoice,
  mapPayPalStatus,
  type PayPalGetInvoiceResponse,
} from "./map";
import type { CreateInvoiceInput } from "../types";

// ---------------------------------------------------------------------------
// centsToDecimalString (reused from money.ts — verify it handles edge cases)
// ---------------------------------------------------------------------------

describe("centsToDecimalString edge cases", () => {
  it("converts 10 cents → 0.10", () => expect(centsToDecimalString(10)).toBe("0.10"));
  it("converts 123456 → 1234.56", () => expect(centsToDecimalString(123456)).toBe("1234.56"));
  it("converts 10000 → 100.00", () => expect(centsToDecimalString(10000)).toBe("100.00"));
  it("converts 100 → 1.00", () => expect(centsToDecimalString(100)).toBe("1.00"));
});

describe("decimalStringToCents edge cases", () => {
  it("parses '0.10' → 10", () => expect(decimalStringToCents("0.10")).toBe(10));
  it("parses '1234.56' → 123456", () => expect(decimalStringToCents("1234.56")).toBe(123456));
  it("parses '100.00' → 10000", () => expect(decimalStringToCents("100.00")).toBe(10000));
  it("parses '100.5' → 10050", () => expect(decimalStringToCents("100.5")).toBe(10050));
  it("parses '100' → 10000", () => expect(decimalStringToCents("100")).toBe(10000));
});

// ---------------------------------------------------------------------------
// mapPayPalStatus
// ---------------------------------------------------------------------------

describe("mapPayPalStatus", () => {
  it("maps DRAFT → DRAFT", () => expect(mapPayPalStatus("DRAFT")).toBe("DRAFT"));
  it("maps SENT → SENT", () => expect(mapPayPalStatus("SENT")).toBe("SENT"));
  it("maps UNPAID → SENT", () => expect(mapPayPalStatus("UNPAID")).toBe("SENT"));
  it("maps SCHEDULED → SENT", () => expect(mapPayPalStatus("SCHEDULED")).toBe("SENT"));
  it("maps PAID → PAID", () => expect(mapPayPalStatus("PAID")).toBe("PAID"));
  it("maps MARKED_AS_PAID → PAID", () => expect(mapPayPalStatus("MARKED_AS_PAID")).toBe("PAID"));
  it("maps PARTIALLY_PAID → PARTIALLY_PAID", () =>
    expect(mapPayPalStatus("PARTIALLY_PAID")).toBe("PARTIALLY_PAID"));
  it("maps CANCELLED → CANCELLED", () => expect(mapPayPalStatus("CANCELLED")).toBe("CANCELLED"));
  it("maps REFUNDED → CANCELLED", () => expect(mapPayPalStatus("REFUNDED")).toBe("CANCELLED"));
  it("maps unknown → UNKNOWN", () => expect(mapPayPalStatus("WHATEVER")).toBe("UNKNOWN"));
  it("is case-insensitive", () => expect(mapPayPalStatus("paid")).toBe("PAID"));
});

// ---------------------------------------------------------------------------
// extractAmountCents / extractPaidCents
// ---------------------------------------------------------------------------

const baseResponse = (): PayPalGetInvoiceResponse => ({
  id: "INV2-TEST",
  status: "SENT",
  detail: { invoice_number: "CH-001" },
});

describe("extractAmountCents", () => {
  it("uses breakdown item_total when present", () => {
    const res = {
      ...baseResponse(),
      amount: { breakdown: { item_total: { currency_code: "USD", value: "1234.56" } } },
    };
    expect(extractAmountCents(res)).toBe(123456);
  });

  it("falls back to amount.value", () => {
    const res = {
      ...baseResponse(),
      amount: { value: "100.00", currency_code: "USD" },
    };
    expect(extractAmountCents(res)).toBe(10000);
  });

  it("returns 0 when no amount", () => {
    expect(extractAmountCents(baseResponse())).toBe(0);
  });
});

describe("extractPaidCents", () => {
  it("extracts paid amount", () => {
    const res = {
      ...baseResponse(),
      payments: { paid_amount: { currency_code: "USD", value: "50.00" } },
    };
    expect(extractPaidCents(res)).toBe(5000);
  });

  it("returns 0 when no payments", () => {
    expect(extractPaidCents(baseResponse())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mapGetResponseToInvoice
// ---------------------------------------------------------------------------

describe("mapGetResponseToInvoice", () => {
  it("maps full response correctly", () => {
    const res: PayPalGetInvoiceResponse = {
      id: "INV2-XXXX",
      status: "PAID",
      detail: {
        invoice_number: "CH-2026-101",
        metadata: { recipient_view_url: "https://sandbox.paypal.com/invoice/p/#ABC" },
      },
      amount: { breakdown: { item_total: { currency_code: "USD", value: "240.00" } } },
      payments: { paid_amount: { currency_code: "USD", value: "240.00" } },
    };
    const mapped = mapGetResponseToInvoice(res);
    expect(mapped).toEqual({
      paypalInvoiceId: "INV2-XXXX",
      number: "CH-2026-101",
      status: "PAID",
      amountCents: 24000,
      paidCents: 24000,
      recipientViewUrl: "https://sandbox.paypal.com/invoice/p/#ABC",
    });
  });

  it("recipientViewUrl is undefined when not present", () => {
    const res = baseResponse();
    const mapped = mapGetResponseToInvoice(res);
    expect(mapped.recipientViewUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildCreateInvoiceBody
// ---------------------------------------------------------------------------

describe("buildCreateInvoiceBody", () => {
  const input: CreateInvoiceInput = {
    requestId: "req-001",
    clientName: "Elena Martinez",
    clientEmail: "elena@example.com",
    number: "CH-2026-101",
    description: "Consulting services",
    amountCents: 240000,
    dueAt: "2026-12-01T00:00:00.000Z",
    note: "Thank you",
  };

  it("produces valid body shape", () => {
    const body = buildCreateInvoiceBody(input, "merchant@sandbox.paypal.com");
    expect(body.detail.invoice_number).toBe("CH-2026-101");
    expect(body.detail.currency_code).toBe("USD");
    expect(body.detail.note).toBe("Thank you");
    expect(body.detail.payment_term.term_type).toBe("DUE_ON_DATE");
    expect(body.detail.payment_term.due_date).toBe("2026-12-01");
    expect(body.invoicer.email_address).toBe("merchant@sandbox.paypal.com");
    expect(body.primary_recipients[0]?.billing_info.email_address).toBe("elena@example.com");
    expect(body.primary_recipients[0]?.billing_info.name.given_name).toBe("Elena");
    expect(body.primary_recipients[0]?.billing_info.name.surname).toBe("Martinez");
    expect(body.items[0]?.unit_amount.value).toBe("2400.00");
    expect(body.items[0]?.quantity).toBe("1");
  });

  it("handles single-word client names", () => {
    const body = buildCreateInvoiceBody({ ...input, clientName: "Zara" }, "m@e.com");
    expect(body.primary_recipients[0]?.billing_info.name.given_name).toBe("Zara");
    expect(body.primary_recipients[0]?.billing_info.name.surname).toBe("");
  });

  it("converts 10 cents correctly", () => {
    const body = buildCreateInvoiceBody({ ...input, amountCents: 10 }, "m@e.com");
    expect(body.items[0]?.unit_amount.value).toBe("0.10");
  });

  it("converts 123456 cents correctly", () => {
    const body = buildCreateInvoiceBody({ ...input, amountCents: 123456 }, "m@e.com");
    expect(body.items[0]?.unit_amount.value).toBe("1234.56");
  });

  it("omits note when not provided", () => {
    const body = buildCreateInvoiceBody({ ...input, note: undefined }, "m@e.com");
    expect(body.detail.note).toBeUndefined();
  });
});

