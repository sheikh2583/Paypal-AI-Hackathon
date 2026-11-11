import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayPalActivity } from "@/components/paypal-activity";
import { PayPalInvoicePanel } from "@/components/paypal-invoice-panel";
import { PayPalModeBadge } from "@/components/paypal-mode-badge";
import { installmentCheck, paypalModeLabel } from "./paypal/display";
import type { InvoiceRow } from "./types";

const invoice: InvoiceRow = {
  id: "invoice-1", paypalInvoiceId: "INV2-EXAMPLE-123456", paypalInvoiceUrl: null,
  clientId: "client-1", number: "CH-001", description: "Design work",
  amountCents: 27_000, paidCents: 0, currency: "USD",
  issuedAt: "2026-11-01T00:00:00.000Z", dueAt: "2026-11-10T00:00:00.000Z",
  status: "SENT", parentInvoiceId: null, planId: null, installmentNo: null,
  chaseState: "NEW", riskScore: 50, riskFactors: [], riskExplanation: null,
  lastAgentRunAt: null, nextFollowupAt: null,
};

describe("PayPal display", () => {
  it("labels real Sandbox and mock modes honestly", () => {
    expect(paypalModeLabel("sandbox", true)).toBe("PayPal Sandbox");
    expect(paypalModeLabel("mock", false)).toBe("Simulated PayPal");
    expect(paypalModeLabel("sandbox", false)).toBe("Simulated PayPal");
    expect(renderToStaticMarkup(createElement(PayPalModeBadge, { mode: "mock", credentialsConfigured: false }))).toContain("Simulated PayPal");
  });

  it("does not render an Open in PayPal link without the stored recipient URL", () => {
    const markup = renderToStaticMarkup(createElement(PayPalInvoicePanel, { invoice, mode: "sandbox", sync: null }));
    expect(markup).toContain("INV2-EXAMP");
    expect(markup).not.toContain("Open in PayPal");
  });

  it("checks installment sums using integer cents", () => {
    expect(installmentCheck([{ amountCents: 27_000 }, { amountCents: 31_500 }, { amountCents: 31_500 }], 90_000))
      .toEqual({ sumCents: 90_000, matchesOriginal: true });
    expect(installmentCheck([{ amountCents: 26_999 }], 27_000).matchesOriginal).toBe(false);
  });

  it("explains the empty webhook feed", () => {
    const markup = renderToStaticMarkup(createElement(PayPalActivity, { events: [] }));
    expect(markup).toContain("PayPal events appear here as soon as an invoice is created, sent, or paid");
  });
});
