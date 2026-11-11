import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "./db/client";
import { insertApproval, listAudit } from "./db/queries";
import { seedDatabase } from "./db/seed";
import { closeTestDb, createTestDb } from "./db/test-utils";
import { emit } from "./events";
import type { AuthEnv } from "./env";
import { __resetOwnerNotificationsForTests, buildApprovalAlert, notifyOwnerOfApproval, ownerEmailHtml, registerOwnerNotifications, type OwnerEmailSender } from "./notifications";
import type { ApprovalRow } from "./types";

const DEMO_NOW = new Date("2026-11-03T00:00:00.000Z");
let database: AppDb;

const configured: AuthEnv = {
  baseUrl: "https://chaser.example.com",
  ownerEmail: "owner@example.com",
  resendApiKey: "re_test_key",
  resendFrom: "Chaser <onboarding@resend.dev>",
} as AuthEnv;

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return insertApproval({
    id: overrides.id ?? "approval-1",
    invoiceId: "invoice-priya-600",
    planId: null,
    kind: "DISCOUNT_REQUEST",
    reason: "Priya asked for 40% off, above the 5% cap.",
    recommendation: "Offer the 5% goodwill discount instead.",
    status: "PENDING",
    ownerResponse: null,
    createdAt: DEMO_NOW.toISOString(),
    resolvedAt: null,
    ...overrides,
  }, database);
}

beforeEach(async () => {
  database = createTestDb();
  await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
  __resetOwnerNotificationsForTests();
});

afterEach(() => {
  __resetOwnerNotificationsForTests();
  closeTestDb(database);
});

describe("owner alerts", () => {
  it("builds a one-line decision request with the invoice, balance and an approvals link", () => {
    const alert = buildApprovalAlert(approval(), { id: "i", number: "CH-2026-103", amountCents: 60_000, paidCents: 0 } as never, { name: "Priya Nair" } as never, configured.baseUrl);
    expect(alert.subject).toBe("Chaser needs your decision: Priya Nair, CH-2026-103");
    expect(alert.heading).toBe("Discount request above your limit");
    expect(alert.message).toContain("$600.00 outstanding");
    expect(alert.actionUrl).toBe("https://chaser.example.com/approvals");
    expect(ownerEmailHtml(alert)).toContain("Review in Chaser");
    expect(ownerEmailHtml({ ...alert, message: "<script>" })).not.toContain("<script>");
  });

  it("sends through the injected sender once per approval and audits the outcome", async () => {
    const send = vi.fn<OwnerEmailSender>(async () => {});
    const row = approval();
    await expect(notifyOwnerOfApproval(row, { database, config: configured, send })).resolves.toBe("sent");
    await expect(notifyOwnerOfApproval(row, { database, config: configured, send })).resolves.toBe("skipped_duplicate");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe("owner@example.com");
    const entries = listAudit(undefined, database).filter((entry) => entry.action === "owner.notified");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.result).toEqual({ outcome: "sent" });
    expect(JSON.stringify(entries[0]?.input)).not.toContain("re_test_key");
  });

  it("skips quietly when email is not configured and records a failure when the provider rejects", async () => {
    await expect(notifyOwnerOfApproval(approval(), { database, config: { ...configured, resendApiKey: undefined }, send: vi.fn() })).resolves.toBe("skipped_not_configured");
    const failing = vi.fn(async () => { throw new Error("boom with owner@example.com"); });
    await expect(notifyOwnerOfApproval(approval({ id: "approval-2" }), { database, config: configured, send: failing })).resolves.toBe("failed");
    const entries = listAudit(undefined, database).filter((entry) => entry.action === "owner.notified");
    expect(entries.map((entry) => entry.ok)).toEqual([false, true]);
  });

  it("reacts to approval.created events and registers only once per process", async () => {
    const send = vi.fn<OwnerEmailSender>(async () => {});
    const stop = registerOwnerNotifications({ database, config: configured, send });
    const again = registerOwnerNotifications({ database, config: configured, send });
    approval();
    emit({ type: "approval.created", invoiceId: "invoice-priya-600", at: DEMO_NOW.toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(1);
    again();
    stop();
  });
});
