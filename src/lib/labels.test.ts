import { describe, expect, it } from "vitest";
import { auditActionLabel, auditResultSummary, chaseStateLabels, initials, paypalEventLabel } from "./labels";

describe("human labels", () => {
  it("names every chase state and PayPal event in plain words", () => {
    expect(chaseStateLabels.ESCALATED).toBe("Waiting on you");
    expect(paypalEventLabel("INVOICING.INVOICE.PAID")).toBe("Invoice paid");
    expect(paypalEventLabel("INVOICING.INVOICE.SOMETHING_NEW")).toBe("invoicing · invoice · something new");
  });

  it("labels audit actions, including PayPal reconciliation and unknown codes", () => {
    expect(auditActionLabel("propose_payment_plan")).toBe("Proposed a payment plan");
    expect(auditActionLabel("reconcile.invoice.paid")).toBe("PayPal confirmed the payment");
    expect(auditActionLabel("reconcile.invoice.partially_paid")).toBe("PayPal reports the invoice as partially paid");
    expect(auditActionLabel("webhook.invoice.sent")).toBe("PayPal event received");
    expect(auditActionLabel("some_new.thing")).toBe("some new thing");
  });

  it("explains policy denials, escalations and errors in one sentence", () => {
    expect(auditResultSummary("propose_payment_plan", { ok: false, violations: [{ code: "DISCOUNT_TOO_HIGH" }, { code: "DEPOSIT_TOO_LOW" }] }, false))
      .toBe("Policy denied the proposal: discount above your cap, deposit below the minimum.");
    expect(auditResultSummary("create_plan_invoices", { ok: false, escalated: true, violations: [{ code: "PLAN_TOO_LONG" }] }, false))
      .toBe("Sent to you for review: plan runs past the allowed duration.");
    expect(auditResultSummary("send_message", { ok: false, error: "TOOL_SCOPE_VIOLATION" }, false))
      .toBe("Blocked: the agent tried to act on a different invoice");
    expect(auditResultSummary("propose_payment_plan", { ok: true, planId: "p", planStatus: "PENDING_APPROVAL", needsOwnerApproval: true }, true))
      .toBe("Within policy, but above your sign-off threshold. Waiting for you.");
    expect(auditResultSummary("create_plan_invoices", { ok: true, installmentsCreated: 3 }, true))
      .toBe("3 installment invoices created and sent through PayPal.");
    expect(auditResultSummary("agent_run", { finalState: "NUDGED", summary: "Sent a reminder." }, true)).toBe("Sent a reminder.");
    expect(auditResultSummary("unknown", null, true)).toBe("Completed.");
  });

  it("builds initials without touching the stored name", () => {
    expect(initials("Dana Whitfield")).toBe("DW");
    expect(initials("priya")).toBe("P");
  });
});
