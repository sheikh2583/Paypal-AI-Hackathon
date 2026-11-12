import { applyClassification } from "./agent/classify";
import { runAgent } from "./agent/run";
import { scripts } from "./agent/scripts";
import { handleToolCall } from "./agent/tools";
import { audit } from "./audit";
import { getNow } from "./clock";
import type { AppDb } from "./db/client";
import { getMessages, getPolicy, insertMessage, listApprovals, resolveApproval } from "./db/queries";
import { demoError } from "./demo";
import { emit } from "./events";
import { getLlmEnv } from "./env";
import { getLLM, ScriptedLLM } from "./llm";
import type { InvoiceRow } from "./types";

export async function runPriyaDemoStep(invoice: InvoiceRow, database: AppDb, counter: boolean): Promise<Response> {
  const invoiceId = invoice.id;
  const existing = listApprovals(undefined, database).find((item) => item.invoiceId === invoiceId && item.kind === "DISCOUNT_REQUEST");
  if (counter) {
    if (!existing || existing.status !== "PENDING") return demoError(409, "NO_PENDING_DISPUTE", "Priya has no discount request awaiting review.");
    if (invoice.status !== "OVERDUE" || invoice.paidCents !== 0 || (getPolicy(database)?.maxDiscountPercent ?? 0) < 5) {
      return demoError(409, "COUNTER_OUT_OF_POLICY", "The 5% counter is unavailable under the current invoice status or owner policy.");
    }
    const now = getNow(database);
    const message = "Thanks for sharing your concerns, Priya. Maya can offer a 5% goodwill discount. Would that help resolve this?";
    const result = JSON.parse(await handleToolCall("send_message", { invoiceId, body: message }, database, now)) as { ok?: boolean };
    if (!result.ok) {
      return demoError(409, "COUNTER_NOT_SENT", "The agent could not relay the counter. Try again.");
    }
    const at = now.toISOString();
    database.$client.transaction(() => {
      resolveApproval(existing.id, "EDITED", "Declined 40%. Offered a 5% goodwill discount.", at, database);
      audit({ actor: "owner", action: "demo.approval.counter", invoiceId, input: { approvalId: existing.id, discountPercent: 5 }, ok: true }, database, at);
    })();
    emit({ type: "invoice.updated", invoiceId, at });
    return Response.json({ done: true, message: "Relayed Maya’s 5% goodwill offer to Priya." });
  }
  if (existing) return Response.json({ done: true, message: "Priya’s discount request is already in Approvals." });

  const reply = scripts.priya.clientReplies[0];
  if (!getMessages(invoiceId, database).some((message) => message.direction === "client_to_agent" && message.body === reply)) {
    insertMessage({ id: crypto.randomUUID(), invoiceId, direction: "client_to_agent", body: reply, createdAt: getNow(database).toISOString() }, database);
    applyClassification(invoiceId, scripts.priya.classifications[0], database);
  }
  // Priya's line is scripted; Chaser's answer is live when a model is configured, with the script as backup (D79).
  const scripted = new ScriptedLLM("priya", 1);
  const live = getLlmEnv().mode === "live" ? getLLM("priya") : undefined;
  const run = await runAgent(invoiceId, "sim", { database, llm: live ?? scripted, fallbackLlm: scripted });
  // The limit is enforced in code: a discount request above the owner's cap always reaches the owner,
  // even if the live model answered without escalating.
  const cap = getPolicy(database)?.maxDiscountPercent ?? 0;
  const requested = scripts.priya.classifications[0]?.requestedDiscountPercent ?? 0;
  if (requested > cap && !listApprovals(undefined, database).some((item) => item.invoiceId === invoiceId && item.kind === "DISCOUNT_REQUEST")) {
    const now = getNow(database);
    await handleToolCall("escalate_to_owner", {
      invoiceId, kind: "DISCOUNT_REQUEST",
      reason: `Priya asked for ${requested}% off, which is above your ${cap}% limit. The policy check sent it to you.`,
      recommendation: `Decide whether to offer a goodwill discount of up to ${cap}%, or explain why the full amount stands.`,
    }, database, now);
    audit({ actor: "system", action: "policy.discount_cap", invoiceId, input: { requestedPercent: requested, capPercent: cap }, result: { escalated: true, reason: "model did not escalate" }, ok: true }, database, now.toISOString());
  }
  return Response.json({ done: false, reply, run });
}
