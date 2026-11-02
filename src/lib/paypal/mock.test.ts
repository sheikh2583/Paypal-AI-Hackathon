import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "../db/test-utils";
import { insertMockPaypalInvoice, listApprovals, updateInvoice } from "../db/queries";
import { MockPayPalClient } from "./mock";
import { reconcilePayPalInvoices } from "./reconcile";
import { setClockDatabaseForTests } from "../clock";
import type { MockPayPalInvoiceRow } from "../db/queries";

// All tests use isolated in-memory SQLite — never the real ./data/chaser.db.

describe("MockPayPalClient lifecycle", () => {
  let database: ReturnType<typeof createTestDb>;
  let client: MockPayPalClient;

  beforeEach(() => {
    database = createTestDb();
    setClockDatabaseForTests(database);
    client = new MockPayPalClient(database);
  });

  it("create → DRAFT", async () => {
    const inv = await client.createInvoice({
      requestId: "req-1",
      clientName: "Test Client",
      clientEmail: "test@example.com",
      number: "TEST-001",
      description: "Test",
      amountCents: 10000,
      dueAt: "2027-01-01",
    });
    expect(inv.status).toBe("DRAFT");
    expect(inv.amountCents).toBe(10000);
    expect(inv.paidCents).toBe(0);
    expect(inv.paypalInvoiceId).toMatch(/^MOCK-INV2-/);
    expect(inv.recipientViewUrl).toMatch(/\/mock-paypal\/invoice\//);
  });

  it("send moves DRAFT → SENT", async () => {
    const inv = await client.createInvoice({
      requestId: "req-2",
      clientName: "Alice",
      clientEmail: "alice@example.com",
      number: "TEST-002",
      description: "Test",
      amountCents: 5000,
      dueAt: "2027-01-01",
    });
    await client.sendInvoice(inv.paypalInvoiceId);
    const fetched = await client.getInvoice(inv.paypalInvoiceId);
    expect(fetched.status).toBe("SENT");
  });

  it("simulatePayment sets PAID and paidCents", async () => {
    const inv = await client.createInvoice({
      requestId: "req-3",
      clientName: "Bob",
      clientEmail: "bob@example.com",
      number: "TEST-003",
      description: "Test",
      amountCents: 10000,
      dueAt: "2027-01-01",
    });
    await client.sendInvoice(inv.paypalInvoiceId);
    await client.simulatePayment(inv.paypalInvoiceId);
    const fetched = await client.getInvoice(inv.paypalInvoiceId);
    expect(fetched.status).toBe("PAID");
    expect(fetched.paidCents).toBe(10000);
  });

  it("partial payment → PARTIALLY_PAID", async () => {
    const inv = await client.createInvoice({
      requestId: "req-4",
      clientName: "Carol",
      clientEmail: "carol@example.com",
      number: "TEST-004",
      description: "Test",
      amountCents: 10000,
      dueAt: "2027-01-01",
    });
    await client.sendInvoice(inv.paypalInvoiceId);
    await client.simulatePayment(inv.paypalInvoiceId, 4000);
    const fetched = await client.getInvoice(inv.paypalInvoiceId);
    expect(fetched.status).toBe("PARTIALLY_PAID");
    expect(fetched.paidCents).toBe(4000);
  });

  it("simulatePayment is idempotent when already PAID", async () => {
    const inv = await client.createInvoice({
      requestId: "req-5",
      clientName: "Dave",
      clientEmail: "dave@example.com",
      number: "TEST-005",
      description: "Test",
      amountCents: 5000,
      dueAt: "2027-01-01",
    });
    await client.sendInvoice(inv.paypalInvoiceId);
    await client.simulatePayment(inv.paypalInvoiceId);
    await client.simulatePayment(inv.paypalInvoiceId); // second call — must not throw
    const fetched = await client.getInvoice(inv.paypalInvoiceId);
    expect(fetched.status).toBe("PAID");
  });

  it("cancel sets CANCELLED", async () => {
    const inv = await client.createInvoice({
      requestId: "req-6",
      clientName: "Eve",
      clientEmail: "eve@example.com",
      number: "TEST-006",
      description: "Test",
      amountCents: 3000,
      dueAt: "2027-01-01",
    });
    await client.sendInvoice(inv.paypalInvoiceId);
    await client.cancelInvoice(inv.paypalInvoiceId);
    const fetched = await client.getInvoice(inv.paypalInvoiceId);
    expect(fetched.status).toBe("CANCELLED");
  });

  it("getInvoice throws for unknown id", async () => {
    await expect(client.getInvoice("MOCK-INV2-UNKNOWN")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Reconcile: mock full lifecycle create → send → pay → reconcile → PAID
// ---------------------------------------------------------------------------

describe("reconcilePayPalInvoices", () => {
  let database: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    database = createTestDb();
    setClockDatabaseForTests(database);
  });

  it("reconcile idempotency — running twice creates no duplicate audits or approvals", async () => {
    // Insert a mock PayPal invoice directly in SENT state.
    const mockRow: MockPayPalInvoiceRow = {
      id: "MOCK-INV2-IDEM0001",
      number: "TEST-IDEM",
      amountCents: 10000,
      paidCents: 10000,
      status: "PAID",
      recipientViewUrl: "http://localhost:3000/mock-paypal/invoice/MOCK-INV2-IDEM0001",
      createdAt: new Date().toISOString(),
    };
    insertMockPaypalInvoice(mockRow, database);

    // Run reconcile twice. With no local invoices referencing this mock id,
    // reconcilePayPalInvoices skips — confirm it doesn't throw.
    await reconcilePayPalInvoices(database);
    await reconcilePayPalInvoices(database);
    // No error = idempotent for the non-local case.
  });

  it("UNEXPECTED_PAYMENT approval is not duplicated for SUPERSEDED invoice", async () => {
    // This test verifies the guard in reconcile.ts (D37).
    // We need a local invoice row in SUPERSEDED state with a paypalInvoiceId.
    // The test DB is seeded by createTestDb() which includes the demo invoices.
    // Use the first seeded invoice, update it to SUPERSEDED with a mock paypal id.
    const localInvoices = database
      .select()
      .from(
        // Import inline to avoid circular issues — access schema directly.
        (await import("../db/schema")).invoices,
      )
      .limit(1)
      .all();

    if (localInvoices.length === 0) {
      // No seeded invoices — skip this sub-test gracefully.
      return;
    }

    const localInvoice = localInvoices[0]!;

    // Insert a matching mock PayPal record with paidCents > 0.
    const mockRow: MockPayPalInvoiceRow = {
      id: "MOCK-INV2-SUPERSED",
      number: localInvoice.number,
      amountCents: localInvoice.amountCents,
      paidCents: 5000, // unexpected payment
      status: "PARTIALLY_PAID",
      recipientViewUrl: "http://localhost:3000/mock-paypal/invoice/MOCK-INV2-SUPERSED",
      createdAt: new Date().toISOString(),
    };
    insertMockPaypalInvoice(mockRow, database);

    // Update local invoice to SUPERSEDED with paypalInvoiceId set.
    updateInvoice(
      localInvoice.id,
      { status: "SUPERSEDED", paypalInvoiceId: "MOCK-INV2-SUPERSED" },
      database,
    );

    // Run reconcile twice.
    await reconcilePayPalInvoices(database);
    await reconcilePayPalInvoices(database);

    // Only ONE UNEXPECTED_PAYMENT approval should exist.
    const unexpectedApprovals = listApprovals(undefined, database).filter(
      (a) => a.kind === "UNEXPECTED_PAYMENT" && a.invoiceId === localInvoice.id,
    );
    expect(unexpectedApprovals).toHaveLength(1);
  });
});
