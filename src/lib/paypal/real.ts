// UNVERIFIED: Built from current PayPal developer docs (Nov 2026, D32/D35).
// Must be tested against live Sandbox credentials before the hackathon demo.
// PayPal Sandbox only — the env guard in getPayPalEnv() prevents live URLs.
import type { Cents, CreateInvoiceInput, PayPalClient, PayPalInvoice } from "../types";
import { getPayPalEnv } from "../env";
import { getAccessToken } from "./auth";
import {
  buildCreateInvoiceBody,
  mapGetResponseToInvoice,
  type PayPalGetInvoiceResponse,
} from "./map";

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class PayPalError extends Error {
  constructor(
    public readonly status: number,
    // Sanitized: no raw response body; safe summary only.
    public readonly sanitizedMessage: string,
  ) {
    super(`PayPal API error ${status}: ${sanitizedMessage}`);
    this.name = "PayPalError";
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paypalFetch(
  url: string,
  init: RequestInit & { requestId?: string },
  env: ReturnType<typeof getPayPalEnv>,
): Promise<Response> {
  const token = await getAccessToken(env);
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Retry only on 5xx or network errors (never 4xx — those are our mistakes).
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new PayPalError(response.status, `Server error on attempt ${attempt + 1}`);
        continue;
      }
      return response;
    } catch (err) {
      // Network / timeout errors are retryable.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) continue;
    }
  }
  throw lastError ?? new Error("PayPal fetch failed after retries");
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

export class RealPayPalClient implements PayPalClient {
  private readonly env: ReturnType<typeof getPayPalEnv>;

  constructor(env?: ReturnType<typeof getPayPalEnv>) {
    this.env = env ?? getPayPalEnv();
  }

  async createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice> {
    const merchantEmail = this.env.merchantEmail;
    if (!merchantEmail) {
      throw new PayPalError(0, "PAYPAL_SANDBOX_MERCHANT_EMAIL is required for real mode");
    }
    const body = buildCreateInvoiceBody(input, merchantEmail);

    const response = await paypalFetch(
      `${this.env.baseUrl}/v2/invoicing/invoices`,
      {
        method: "POST",
        requestId: input.requestId,
        body: JSON.stringify(body),
      },
      this.env,
    );

    if (response.status !== 201) {
      throw new PayPalError(response.status, `Create invoice returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as PayPalGetInvoiceResponse;
    const invoiceId = data.id;
    if (!invoiceId) {
      throw new PayPalError(201, "Create invoice response missing id");
    }

    // Fetch full record to get recipient_view_url (may not be in create response).
    return this.getInvoice(invoiceId);
  }

  async sendInvoice(paypalInvoiceId: string): Promise<void> {
    const response = await paypalFetch(
      `${this.env.baseUrl}/v2/invoicing/invoices/${paypalInvoiceId}/send`,
      {
        method: "POST",
        body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }),
      },
      this.env,
    );

    // 202 Accepted is the success code for send. 200 is also accepted.
    if (response.status !== 202 && response.status !== 200) {
      throw new PayPalError(response.status, `Send invoice returned HTTP ${response.status}`);
    }
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice> {
    const response = await paypalFetch(
      `${this.env.baseUrl}/v2/invoicing/invoices/${paypalInvoiceId}`,
      { method: "GET" },
      this.env,
    );

    if (!response.ok) {
      throw new PayPalError(response.status, `Get invoice returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as PayPalGetInvoiceResponse;
    return mapGetResponseToInvoice(data);
  }

  async cancelInvoice(paypalInvoiceId: string): Promise<void> {
    const response = await paypalFetch(
      `${this.env.baseUrl}/v2/invoicing/invoices/${paypalInvoiceId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({
          subject: "Invoice cancelled",
          note: "Superseded by a payment plan.",
          send_to_payer: false,
          send_to_invoicer: false,
        }),
      },
      this.env,
    );

    // 204 No Content is success. 200 is also accepted.
    if (response.status !== 204 && response.status !== 200) {
      throw new PayPalError(response.status, `Cancel invoice returned HTTP ${response.status}`);
    }
  }

  // simulatePayment is mock-only; throw in real mode.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  simulatePayment(_paypalInvoiceId: string, _amountCents?: Cents): Promise<void> {
    return Promise.reject(new Error("simulatePayment is not available in real (sandbox) mode"));
  }
}
