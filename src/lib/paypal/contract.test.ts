import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb } from "../db/test-utils";
import { getPayPalEnv } from "../env";
import type { CreateInvoiceInput } from "../types";
import { clearTokenCache } from "./auth";
import draftFixture from "./__fixtures__/invoice-draft.json";
import scheduledFixture from "./__fixtures__/invoice-scheduled.json";
import { mapGetResponseToInvoice } from "./map";
import { MockPayPalClient } from "./mock";
import { RealPayPalClient } from "./real";

const input: CreateInvoiceInput = {
  requestId: "sandbox-contract",
  clientName: "Test Buyer",
  clientEmail: "buyer@example.com",
  number: draftFixture.detail.invoice_number,
  description: "Smoke test invoice",
  amountCents: 1000,
  dueAt: "2026-11-17",
};

describe("PayPal response contract", () => {
  it("mock draft and sent invoices match mapped Sandbox responses", async () => {
    const database = createTestDb();
    try {
      const client = new MockPayPalClient(database);
      const created = await client.createInvoice(input);
      const draft = await client.getInvoice(created.paypalInvoiceId);
      await client.sendInvoice(created.paypalInvoiceId);
      const sent = await client.getInvoice(created.paypalInvoiceId);

      for (const [mock, fixture, status] of [
        [draft, draftFixture, "DRAFT"],
        [sent, scheduledFixture, "SENT"],
      ] as const) {
        const sandbox = mapGetResponseToInvoice(fixture);
        expect(sandbox).toStrictEqual({
          paypalInvoiceId: fixture.id,
          number: input.number,
          status,
          amountCents: 1000,
          paidCents: 0,
          recipientViewUrl: fixture.detail.metadata.recipient_view_url,
        });
        expect(mock.paypalInvoiceId).toMatch(/^MOCK-INV2-/);
        expect(mock.recipientViewUrl).toContain(`/mock-paypal/invoice/${mock.paypalInvoiceId}`);
        expect(mock).toStrictEqual({
          ...sandbox,
          paypalInvoiceId: mock.paypalInvoiceId,
          recipientViewUrl: mock.recipientViewUrl,
        });
      }
    } finally {
      closeTestDb(database);
    }
  });
});

describe("Sandbox draft creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokenCache();
  });

  it("extracts the ID from a create response link and reads the draft from Sandbox", async () => {
    const env = getPayPalEnv({
      PAYPAL_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "test-client",
      PAYPAL_CLIENT_SECRET: "test-secret",
      PAYPAL_SANDBOX_MERCHANT_EMAIL: "merchant@example.com",
    });
    const invoicesUrl = `${env.baseUrl}/v2/invoicing/invoices`;
    const getUrl = `${invoicesUrl}/${draftFixture.id}`;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "test-token" }))
      .mockResolvedValueOnce(Response.json({ href: getUrl }, { status: 201 }))
      .mockResolvedValueOnce(Response.json(draftFixture));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new RealPayPalClient(env).createInvoice(input)).resolves.toStrictEqual(
      mapGetResponseToInvoice(draftFixture),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, invoicesUrl, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "PayPal-Request-Id": input.requestId }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, getUrl, expect.objectContaining({ method: "GET" }));
  });
});
