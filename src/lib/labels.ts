// Human wording for the codes the app stores. Judges and owners read these; the
// codes themselves stay in the database and the audit trail untouched.
import type { ApprovalKind, ChaseState, InvoiceStatus, PlanStatus, ReplyClassification } from "./types";

export const chaseStateLabels: Record<ChaseState, string> = {
  NEW: "No reminder yet",
  NUDGED: "Reminder sent",
  NEGOTIATING: "Negotiating",
  PLAN_OFFERED: "Plan offered",
  PLAN_ACCEPTED: "Plan accepted",
  PLAN_ACTIVE: "Plan active",
  ESCALATED: "Waiting on you",
  RESOLVED: "Resolved",
};

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  SENT: "Sent",
  OVERDUE: "Overdue",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  SUPERSEDED: "Replaced by plan",
};

export const planStatusLabels: Record<PlanStatus, string> = {
  OFFERED: "Offered to the client",
  ACCEPTED: "Accepted by the client",
  ACTIVE: "Active",
  RESOLVED: "Paid in full",
  REJECTED: "Declined by the client",
  EXPIRED: "Expired",
  PENDING_APPROVAL: "Waiting for your sign-off",
};

export const approvalKindLabels: Record<ApprovalKind, string> = {
  PLAN_OUT_OF_BOUNDS: "Plan outside your policy",
  PLAN_NEEDS_SIGNOFF: "Payment plan needs your sign-off",
  DISCOUNT_REQUEST: "Discount request above your limit",
  DISPUTE: "Client dispute",
  UNCLEAR: "Needs a human read",
  ABUSE: "Abusive message",
  UNEXPECTED_PAYMENT: "Unexpected payment",
  PAYPAL_ERROR: "PayPal error",
};

export const intentLabels: Record<ReplyClassification["intent"], string> = {
  will_pay_full: "will pay in full",
  cannot_pay_full: "cannot pay in full right now",
  accepts_plan: "accepts the plan",
  rejects_plan: "rejects the plan",
  asks_discount: "asks for a discount",
  disputes: "disputes the invoice",
  asks_extension: "asks for more time",
  abusive: "abusive",
  unclear: "unclear",
  other: "something else",
};

export const actorLabels: Record<"agent" | "owner" | "system" | "paypal", string> = {
  agent: "Chaser",
  owner: "You",
  system: "System",
  paypal: "PayPal",
};

const auditActions: Record<string, string> = {
  get_invoice_context: "Reviewed the invoice",
  send_message: "Sent a message to the client",
  classify_client_reply: "Read the client's reply",
  propose_payment_plan: "Proposed a payment plan",
  create_plan_invoices: "Created installment invoices in PayPal",
  cancel_original_invoice: "Cancelled the original PayPal invoice",
  escalate_to_owner: "Asked for your decision",
  schedule_followup: "Scheduled a follow-up",
  agent_run: "Finished an agent run",
  "agent.iteration_cap": "Stopped at the tool-call limit",
  "llm.fallback": "Switched to the guided reply after a provider error",
  "llm.call": "Asked the AI model",
  "owner.notified": "Emailed you about a pending decision",
  "autopilot.run": "Autopilot checked due invoices",
  "autopilot.toggle": "Autopilot setting changed",
  "demo.approval.counter": "You sent a counter-offer",
  "demo.reset.cancel_invoice": "Demo reset cancelled a PayPal invoice",
  "demo.advance_time": "Demo clock advanced",
  "eval.owner_decision": "Owner decision recorded",
  "reconcile.unexpected_payment": "PayPal reported an unexpected payment",
  "reconcile.plan.progress": "Payment plan progress updated from PayPal",
  "reconcile.risk.error": "Risk refresh failed after a PayPal update",
  "reconcile.get_invoice.error": "Could not read the invoice from PayPal",
  "webhook.invoice.unknown": "Unmatched PayPal event",
  "webhook.invoice.unmatched": "Unmatched PayPal event",
  "webhook.demo_reset.cancellation": "PayPal invoice cancelled by demo reset",
  "webhook.processing.error": "PayPal event needs reconciliation",
};

export function auditActionLabel(action: string): string {
  if (auditActions[action]) return auditActions[action];
  if (action.startsWith("reconcile.invoice.")) {
    const status = action.slice("reconcile.invoice.".length).toUpperCase() as InvoiceStatus;
    return status === "PAID" ? "PayPal confirmed the payment" : `PayPal reports the invoice as ${invoiceStatusLabels[status]?.toLowerCase() ?? status.toLowerCase()}`;
  }
  if (action.startsWith("webhook.")) return "PayPal event received";
  return action.replaceAll(/[._]/g, " ");
}

const errorCodes: Record<string, string> = {
  TOOL_SCOPE_VIOLATION: "Blocked: the agent tried to act on a different invoice",
  UNKNOWN_TOOL: "Blocked: the agent asked for a tool that does not exist",
  MESSAGE_POLICY_LEAK: "Blocked: the message would have revealed internal instructions",
  MESSAGE_UNSAFE_TONE: "Blocked: the message tone broke the rules",
  URL_NOT_ALLOWED: "Blocked: the message linked outside PayPal",
  INVOICE_NOT_ELIGIBLE: "Declined: this invoice cannot take a payment plan",
  PLAN_NOT_ACCEPTED: "Declined: the client has not accepted this plan yet",
  VALIDATION_ERROR: "Declined: the tool input was invalid",
  ITERATION_LIMIT: "Stopped: tool-call limit reached",
  AGENT_RUN_TIMEOUT: "Stopped: the run exceeded its time limit",
};

const violationCodes: Record<string, string> = {
  DEPOSIT_TOO_LOW: "deposit below the minimum",
  TOO_MANY_INSTALLMENTS: "too many installments",
  PLAN_TOO_LONG: "plan runs past the allowed duration",
  DISCOUNT_TOO_HIGH: "discount above your cap",
  TOTAL_MISMATCH: "installments do not add up",
  INSTALLMENT_NOT_POSITIVE: "an installment was not positive",
  DUE_DATE_IN_PAST: "a due date was in the past",
  INVOICE_NOT_ELIGIBLE: "invoice not eligible",
  PLAN_TOO_SMALL: "plan too small",
};

/** One plain sentence for an audit result; the raw record stays available separately. */
export function auditResultSummary(action: string, result: unknown, ok: boolean, input?: unknown): string {
  const fields = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const given = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (typeof given.eventType === "string") {
    const id = typeof given.paypalInvoiceId === "string" ? ` · PayPal ${given.paypalInvoiceId}` : "";
    return `${paypalEventLabel(given.eventType)}${id}.`;
  }
  if (typeof fields.outcome === "string") {
    const outcomes: Record<string, string> = {
      sent: "Email sent to the owner with a link to Approvals.",
      skipped_not_configured: "Email skipped: no email provider is configured for this deployment.",
      skipped_duplicate: "Already emailed about this decision.",
      failed: "The email provider rejected the message.",
    };
    return outcomes[fields.outcome] ?? `Outcome: ${fields.outcome}.`;
  }
  if (typeof fields.intent === "string") {
    const words = intentLabels[fields.intent as ReplyClassification["intent"]] ?? fields.intent;
    return `Understood as “${words}”.`;
  }
  const violations = Array.isArray(fields.violations) ? fields.violations as { code?: string }[] : [];
  if (violations.length) {
    const reasons = violations.map(({ code }) => (code && violationCodes[code]) || String(code ?? "policy rule").toLowerCase().replaceAll("_", " "));
    return `${fields.escalated ? "Sent to you for review" : "Policy denied the proposal"}: ${reasons.join(", ")}.`;
  }
  if (typeof fields.error === "string") return errorCodes[fields.error] ?? `Failed: ${fields.error.toLowerCase().replaceAll("_", " ")}`;
  if (fields.paypalError) return "PayPal rejected the request; sent to you for review.";
  if (typeof fields.summary === "string") return fields.summary;
  if (fields.needsOwnerApproval) return "Within policy, but above your sign-off threshold. Waiting for you.";
  if (action === "propose_payment_plan" && ok) return "Policy allowed the plan. Offered to the client.";
  if (action === "create_plan_invoices" && typeof fields.installmentsCreated === "number") return `${fields.installmentsCreated} installment invoices created and sent through PayPal.`;
  if (action === "schedule_followup" && typeof fields.nextFollowupAt === "string") return `Next follow-up on ${fields.nextFollowupAt.slice(0, 10)}.`;
  if (action === "llm.fallback") return "The guided reply finished the step so the client still got an answer.";
  if (action === "llm.call") {
    // Only the key number and model are shown, never the key (D75).
    const who = typeof given.keyNumber === "number" ? `Key #${given.keyNumber}` : "The model";
    const model = typeof given.model === "string" ? ` · ${given.model}` : "";
    const seconds = typeof fields.latencyMs === "number" ? ` · ${(fields.latencyMs / 1000).toFixed(1)} s` : "";
    if (ok) return `${who}${model} answered${seconds}.`;
    return `${who}${model} was busy or unavailable (${fields.status === 0 ? "no response" : `HTTP ${String(fields.status)}`}); Chaser moved on to another key or the guided reply.`;
  }
  if (typeof fields.fallback === "string") return "Handled by the guided reply.";
  if (typeof fields.code === "string") return errorCodes[fields.code] ?? `Failed: ${fields.code.toLowerCase().replaceAll("_", " ")}`;
  if (typeof fields.message === "string") return fields.message;
  if (typeof fields.reason === "string") return fields.reason;
  return ok ? "Completed." : "Failed.";
}

const paypalEvents: Record<string, string> = {
  "INVOICING.INVOICE.CREATED": "Invoice created",
  "INVOICING.INVOICE.SENT": "Invoice sent to the client",
  "INVOICING.INVOICE.SCHEDULED": "Invoice scheduled",
  "INVOICING.INVOICE.PAID": "Invoice paid",
  "INVOICING.INVOICE.UPDATED": "Invoice updated",
  "INVOICING.INVOICE.CANCELLED": "Invoice cancelled",
  "INVOICING.INVOICE.REFUNDED": "Invoice refunded",
};

export function paypalEventLabel(eventType: string): string {
  return paypalEvents[eventType] ?? eventType.replaceAll(".", " · ").replaceAll("_", " ").toLowerCase();
}

export function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** Short, non-secret provider name for the header badge, derived from the configured endpoint. */
export function llmProviderLabel(env: { provider: "anthropic" | "openai-compatible"; baseUrl?: string; model: string }): string {
  if (env.provider === "anthropic") return "Claude";
  let host = "";
  try { host = new URL(env.baseUrl ?? "").hostname; } catch { host = ""; }
  if (host.includes("groq")) return "Groq";
  if (host.includes("googleapis")) return "Gemini";
  if (host.includes("openrouter")) return "OpenRouter";
  if (host.endsWith("openai.com")) return "OpenAI";
  return env.model || "Live model";
}
