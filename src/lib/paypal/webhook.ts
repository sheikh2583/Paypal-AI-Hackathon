import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db/client";
import { getInvoiceByPayPalId, isWebhookEventPending, listPendingWebhookEvents, markWebhookEventProcessed, upsertWebhookEvent } from "../db/queries";
import { getPayPalEnv, type PayPalEnv } from "../env";
import { paypalFetch } from "./real";
import { reconcilePayPalInvoice } from "./reconcile";
import { isExpectedResetPayPalCancellation } from "./reset-cleanup";

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9_-]+$/i);
const invoiceRef = z.object({ id: identifier.optional() });
const eventSchema = z.object({
  id: identifier,
  event_type: z.string().min(1).max(100).regex(/^[A-Z0-9_.]+$/),
  resource: invoiceRef.extend({ invoice: invoiceRef.optional() }).optional(),
});
const supportedEvents = new Set(
  ["PAID", "CANCELLED", "REFUNDED", "CREATED", "SENT", "UPDATED", "SCHEDULED"]
    .map((type) => `INVOICING.INVOICE.${type}`),
);
const MAX_EVENT_BYTES = 256 * 1024;
const processScope = globalThis as typeof globalThis & { chaserWebhooksInFlight?: Set<string> };
const inFlight = processScope.chaserWebhooksInFlight ??= new Set<string>();

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function readEvent(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing event body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_EVENT_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new RangeError("Event body too large");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

async function verifySignature(headers: Headers, event: unknown, env: PayPalEnv): Promise<boolean> {
  if (env.mode === "mock") return headers.get("x-chaser-mock-webhook") === "1";
  const transmission = {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
  };
  if (Object.values(transmission).some((value) => !value)) return false;
  if (!env.webhookId) throw new Error("PAYPAL_WEBHOOK_ID is missing");
  const response = await paypalFetch(`${env.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    body: JSON.stringify({ ...transmission, webhook_id: env.webhookId, webhook_event: event }),
  }, env, 0);
  if (response.status === 400 || response.status === 422) return false;
  if (!response.ok) throw new Error("PayPal signature verification unavailable");
  const result = z.object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) }).parse(await response.json());
  return result.verification_status === "SUCCESS";
}

async function processEvent(id: string, type: string, paypalInvoiceId?: string): Promise<void> {
  if (inFlight.has(id) || !isWebhookEventPending(id)) return;
  inFlight.add(id);
  const input = { eventId: id, eventType: type, paypalInvoiceId };
  try {
    const localInvoice = paypalInvoiceId ? getInvoiceByPayPalId(paypalInvoiceId, db) : undefined;
    const expectedResetCancellation = !localInvoice && type === "INVOICING.INVOICE.CANCELLED"
      && paypalInvoiceId !== undefined && isExpectedResetPayPalCancellation(paypalInvoiceId, db);
    const outcome = !supportedEvents.has(type) ? "unsupported_event"
      : !paypalInvoiceId ? "missing_invoice_id"
        : expectedResetCancellation ? "expected_reset_cancellation"
          : !localInvoice ? "unmatched_invoice"
            : await reconcilePayPalInvoice(paypalInvoiceId);
    const isUnmatched = outcome === "missing_invoice_id" || outcome === "unmatched_invoice";
    audit({
      actor: "paypal",
      action: outcome === "expected_reset_cancellation" ? "webhook.demo_reset.cancellation"
        : isUnmatched ? "webhook.invoice.unmatched" : "webhook.processed",
      input, result: { outcome }, ok: !isUnmatched,
    });
    markWebhookEventProcessed(id);
  } catch {
    audit({
      actor: "paypal", action: "webhook.processing.error", input,
      result: { code: "PAYPAL_RECONCILIATION_FAILED" }, ok: false,
    });
  } finally {
    inFlight.delete(id);
  }
}

export async function retryPendingPayPalWebhooks(): Promise<void> {
  const payloadSchema = z.object({ paypalInvoiceId: identifier.optional() });
  for (const event of listPendingWebhookEvents()) {
    let paypalInvoiceId: string | undefined;
    try {
      paypalInvoiceId = payloadSchema.safeParse(JSON.parse(event.payloadJson)).data?.paypalInvoiceId;
    } catch {
      // Treat a missing or corrupt stored invoice reference as an unknown invoice.
    }
    await processEvent(event.id, event.eventType, paypalInvoiceId);
  }
}

export async function receivePayPalWebhook(request: Request, schedule: (work: () => Promise<void>) => void): Promise<Response> {
  let body: unknown;
  try {
    body = await readEvent(request);
  } catch (cause) {
    return cause instanceof RangeError
      ? error(413, "PAYLOAD_TOO_LARGE", "Webhook body exceeds the size limit.")
      : error(400, "INVALID_JSON", "Expected a JSON webhook event.");
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return error(400, "INVALID_EVENT", "Invalid PayPal webhook event.");
  try {
    if (!await verifySignature(request.headers, body, getPayPalEnv())) {
      return error(400, "INVALID_SIGNATURE", "Webhook signature verification failed.");
    }
  } catch {
    return error(503, "VERIFICATION_UNAVAILABLE", "Webhook signature verification is unavailable.");
  }

  const { id, event_type: type, resource } = parsed.data;
  const paypalInvoiceId = resource?.invoice?.id ?? resource?.id;
  // Persist only identifiers needed for reconciliation. Never store headers or the original body.
  if (upsertWebhookEvent({ id, eventType: type, payload: { paypalInvoiceId } }, db)) {
    schedule(() => processEvent(id, type, paypalInvoiceId));
  }
  return Response.json({ received: true });
}
