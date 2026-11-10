// Mock PayPal client backed by the mock_paypal_invoices table.
// Supports every flow the real client does (hard rule 8).
// Uses getNow() from clock.ts, never new Date().
import type { Cents, CreateInvoiceInput, PayPalClient, PayPalInvoice } from "../types";
import { getAppEnv } from "../env";
import { getNow } from "../clock";
import { db, type AppDb } from "../db/client";
import {
  getMockPaypalInvoice,
  insertMockPaypalInvoice,
  type MockPayPalInvoiceRow,
  updateMockPaypalInvoice,
} from "../db/queries";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

// Fake ids are clearly non-real: MOCK-INV2-<8-char prefix from UUID> (D36).
function generateMockId(): string {
  return `MOCK-INV2-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapMockRowToPayPalInvoice(row: MockPayPalInvoiceRow): PayPalInvoice {
  return {
    paypalInvoiceId: row.id,
    number: row.number,
    status: row.status as PayPalInvoice["status"],
    amountCents: row.amountCents,
    paidCents: row.paidCents,
    recipientViewUrl: row.recipientViewUrl,
  };
}

function getBaseUrl(): string {
  return getAppEnv().appBaseUrl;
}

// ---------------------------------------------------------------------------
// MockPayPalClient
// ---------------------------------------------------------------------------

export class MockPayPalClient implements PayPalClient {
  private readonly database: AppDb;

  constructor(database: AppDb = db) {
    this.database = database;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice> {
    const id = generateMockId();
    const recipientViewUrl = `${getBaseUrl()}/mock-paypal/invoice/${id}`;
    const row: MockPayPalInvoiceRow = {
      id,
      number: input.number,
      amountCents: input.amountCents,
      paidCents: 0,
      status: "DRAFT",
      recipientViewUrl,
      createdAt: getNow(this.database).toISOString(),
    };
    insertMockPaypalInvoice(row, this.database);
    return mapMockRowToPayPalInvoice(row);
  }

  async sendInvoice(paypalInvoiceId: string): Promise<void> {
    const row = getMockPaypalInvoice(paypalInvoiceId, this.database);
    if (!row) {
      throw new Error(`Mock invoice not found: ${paypalInvoiceId}`);
    }
    if (row.status !== "DRAFT") {
      throw new Error(`Mock invoice ${paypalInvoiceId} cannot be sent from status ${row.status}`);
    }
    updateMockPaypalInvoice(paypalInvoiceId, { status: "SENT" }, this.database);
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoice> {
    const row = getMockPaypalInvoice(paypalInvoiceId, this.database);
    if (!row) {
      throw new Error(`Mock invoice not found: ${paypalInvoiceId}`);
    }
    return mapMockRowToPayPalInvoice(row);
  }

  async cancelInvoice(paypalInvoiceId: string): Promise<void> {
    const row = getMockPaypalInvoice(paypalInvoiceId, this.database);
    if (!row) {
      throw new Error(`Mock invoice not found: ${paypalInvoiceId}`);
    }
    updateMockPaypalInvoice(paypalInvoiceId, { status: "CANCELLED" }, this.database);
  }

  /**
   * Simulates a client paying the mock invoice.
   * Reconciliation emits events after the local invoice has been updated.
   * amountCents defaults to the remaining balance.
   */
  async simulatePayment(paypalInvoiceId: string, amountCents?: Cents): Promise<void> {
    const row = getMockPaypalInvoice(paypalInvoiceId, this.database);
    if (!row) {
      throw new Error(`Mock invoice not found: ${paypalInvoiceId}`);
    }
    if (row.status === "PAID") {
      return; // Already paid — idempotent.
    }
    if (row.status === "CANCELLED") {
      throw new Error(`Mock invoice ${paypalInvoiceId} is CANCELLED and cannot be paid`);
    }

    const payment = amountCents ?? row.amountCents - row.paidCents;
    const newPaid = Math.min(row.amountCents, row.paidCents + payment);
    const newStatus = newPaid >= row.amountCents ? "PAID" : "PARTIALLY_PAID";

    updateMockPaypalInvoice(
      paypalInvoiceId,
      { status: newStatus, paidCents: newPaid },
      this.database,
    );
  }
}

