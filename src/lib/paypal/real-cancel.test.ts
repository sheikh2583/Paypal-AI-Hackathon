import { afterEach, describe, expect, it, vi } from "vitest";
import { invoiceDateForPayPal } from "./map";
import { PayPalError, RealPayPalClient } from "./real";

vi.mock("./auth", () => ({ getAccessToken: async () => "test-token" }));

const env = { mode: "sandbox", baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "secret", webhookId: undefined, merchantEmail: "m@example.com", buyerEmail: undefined } as unknown as ConstructorParameters<typeof RealPayPalClient>[0];
const calls: { method: string; url: string }[] = [];
const respond = (...statuses: number[]) => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ method: init?.method ?? "GET", url });
  return new Response(null, { status: statuses.shift() ?? 500 });
}));

afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });

describe("RealPayPalClient.cancelInvoice", () => {
  it("cancels a sent invoice with one call", async () => {
    respond(204);
    await new RealPayPalClient(env).cancelInvoice("INV2-SENT");
    expect(calls).toEqual([{ method: "POST", url: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-SENT/cancel" }]);
  });

  it("deletes a scheduled or draft invoice that PayPal refuses to cancel", async () => {
    respond(422, 204);
    await new RealPayPalClient(env).cancelInvoice("INV2-SCHEDULED");
    expect(calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
    expect(calls[1].url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-SCHEDULED");
  });

  it("reports the HTTP status when neither cancel nor delete works", async () => {
    respond(422, 404);
    await expect(new RealPayPalClient(env).cancelInvoice("INV2-GONE")).rejects.toMatchObject({ status: 404 });
    respond(403);
    await expect(new RealPayPalClient(env).cancelInvoice("INV2-FORBIDDEN")).rejects.toBeInstanceOf(PayPalError);
  });
});

describe("invoiceDateForPayPal", () => {
  it("never dates an invoice after the merchant's local day", () => {
    // 04:47 UTC is already Nov 12 in UTC but still Nov 11 in Canada and the US.
    expect(invoiceDateForPayPal(new Date("2026-11-12T04:47:00Z"))).toBe("2026-11-11");
    expect(invoiceDateForPayPal(new Date("2026-11-12T17:10:00Z"))).toBe("2026-11-12");
  });
});
