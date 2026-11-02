import { describe, expect, it } from "vitest";
import { seedDatabase } from "./seed";
import { closeTestDb, createTestDb } from "./test-utils";

describe("seedDatabase", () => {
  it("is idempotent and returns five overdue invoice summaries", () => {
    const database = createTestDb();
    const now = new Date("2026-11-02T12:00:00.000Z");
    try {
      const firstSummaries = seedDatabase(database, { paypalMode: "mock" }, now);
      const firstCounts = database.$client
        .prepare(
          `SELECT (SELECT count(*) FROM clients) AS clients,
                  (SELECT count(*) FROM invoices) AS invoices,
                  (SELECT count(*) FROM messages) AS messages,
                  (SELECT count(*) FROM mock_paypal_invoices) AS mockInvoices`,
        )
        .get();
      const firstInvoices = database.$client
        .prepare("SELECT id, status, amount_cents, due_at FROM invoices ORDER BY id")
        .all();

      const secondSummaries = seedDatabase(database, { paypalMode: "mock" }, now);
      const secondCounts = database.$client
        .prepare(
          `SELECT (SELECT count(*) FROM clients) AS clients,
                  (SELECT count(*) FROM invoices) AS invoices,
                  (SELECT count(*) FROM messages) AS messages,
                  (SELECT count(*) FROM mock_paypal_invoices) AS mockInvoices`,
        )
        .get();
      const secondInvoices = database.$client
        .prepare("SELECT id, status, amount_cents, due_at FROM invoices ORDER BY id")
        .all();

      expect(secondCounts).toEqual(firstCounts);
      expect(secondInvoices).toEqual(firstInvoices);
      expect(firstCounts).toEqual({ clients: 5, invoices: 7, messages: 7, mockInvoices: 7 });
      expect(firstSummaries.map(({ daysOverdue }) => daysOverdue)).toEqual([23, 31, 14, 9, 5]);
      expect(secondSummaries).toEqual(firstSummaries);
      expect(firstSummaries.map(({ client, amountCents }) => [client, amountCents])).toEqual([
        ["Elena Martinez", 240000],
        ["Priya Shah", 180000],
        ["Marcus Lee", 96000],
        ["Olivia Chen", 125000],
        ["Noah Williams", 54000],
      ]);
    } finally {
      closeTestDb(database);
    }
  });
});
