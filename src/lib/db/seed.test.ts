import { describe, expect, it } from "vitest";
import { seedDatabase } from "./seed";
import { closeTestDb, createTestDb } from "./test-utils";

// Pinned "now" for deterministic assertions
const DEMO_NOW = new Date("2026-11-02T12:00:00.000Z");

describe("seedDatabase", () => {
  it("is idempotent — second run produces identical rows", async () => {
    const database = createTestDb();
    try {
      const firstSummaries = await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
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

      const secondSummaries = await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
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
      expect(secondSummaries).toEqual(firstSummaries);
    } finally {
      closeTestDb(database);
    }
  });

  // Contract test: seeded invoices must match the exact table in docs/07.
  // Total overdue must equal $5,500 (550000 cents).
  it("matches docs/07 seed data exactly", async () => {
    const database = createTestDb();
    try {
      const summaries = await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);

      // Exact five clients/invoices from docs/07 in persona order
      expect(summaries).toHaveLength(5);
      expect(summaries.map(({ persona, amountCents, daysOverdue }) => ({
        persona,
        amountCents,
        daysOverdue,
      }))).toEqual([
        { persona: "dana",   amountCents: 90000,  daysOverdue: 23 },
        { persona: "marcus", amountCents: 125000, daysOverdue: 41 },
        { persona: "priya",  amountCents: 60000,  daysOverdue: 12 },
        { persona: "tom",    amountCents: 35000,  daysOverdue: 6  },
        { persona: "elena",  amountCents: 240000, daysOverdue: 18 },
      ]);

      // Total overdue: $5,500
      const total = summaries.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(550000);
    } finally {
      closeTestDb(database);
    }
  });

  it("returns five overdue invoice summaries with correct client names", async () => {
    const database = createTestDb();
    try {
      const summaries = await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      expect(summaries.map(({ client, amountCents }) => [client, amountCents])).toEqual([
        ["Dana Whitfield",  90000],
        ["Marcus Lee",     125000],
        ["Priya Nair",      60000],
        ["Tom Brennan",     35000],
        ["Elena Cruz",     240000],
      ]);
    } finally {
      closeTestDb(database);
    }
  });

  it("seeds correct table row counts: 5 clients, 7 invoices, 7 messages, 7 mock PayPal rows", async () => {
    const database = createTestDb();
    try {
      await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      const counts = database.$client
        .prepare(
          `SELECT (SELECT count(*) FROM clients) AS clients,
                  (SELECT count(*) FROM invoices) AS invoices,
                  (SELECT count(*) FROM messages) AS messages,
                  (SELECT count(*) FROM mock_paypal_invoices) AS mockInvoices`,
        )
        .get();
      // 5 overdue + 2 history (dana, marcus) = 7 invoices
      expect(counts).toEqual({ clients: 5, invoices: 7, messages: 7, mockInvoices: 7 });
    } finally {
      closeTestDb(database);
    }
  });

  it("seeds owner policy matching docs/07 exactly", async () => {
    const database = createTestDb();
    try {
      await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      const policy = database.$client
        .prepare(
          `SELECT min_deposit_percent, max_installments, max_plan_days,
                  max_discount_percent, auto_approve_below_cents, tone,
                  business_name, owner_name
           FROM owner_policy WHERE id = 'default'`,
        )
        .get() as Record<string, unknown>;
      expect(policy).toEqual({
        min_deposit_percent: 30,
        max_installments: 3,
        max_plan_days: 90,
        max_discount_percent: 5,
        auto_approve_below_cents: 150000,
        tone: "friendly",
        business_name: "Rahman Design Studio",
        owner_name: "Maya Rahman",
      });
    } finally {
      closeTestDb(database);
    }
  });

  it("uses fake @example.com emails in mock mode", async () => {
    const database = createTestDb();
    try {
      await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      const emails = database.$client
        .prepare("SELECT email FROM clients ORDER BY id")
        .all() as { email: string }[];
      for (const { email } of emails) {
        expect(email).toMatch(/@example\.com$/);
      }
    } finally {
      closeTestDb(database);
    }
  });

  it("uses sandbox buyer email for every client in sandbox mode", async () => {
    const database = createTestDb();
    const buyerEmail = "buyer@sandbox.paypal.com";
    try {
      await seedDatabase(database, { paypalMode: "sandbox", sandboxBuyerEmail: buyerEmail }, DEMO_NOW);
      const emails = database.$client
        .prepare("SELECT email FROM clients ORDER BY id")
        .all() as { email: string }[];
      for (const { email } of emails) {
        expect(email).toBe(buyerEmail);
      }
    } finally {
      closeTestDb(database);
    }
  });

  it("history invoices are PAID and their clients have matching late history", async () => {
    const database = createTestDb();
    try {
      await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      const paidInvoices = database.$client
        .prepare("SELECT id, status FROM invoices WHERE status = 'PAID'")
        .all() as { id: string; status: string }[];
      // dana and marcus have history invoices
      expect(paidInvoices).toHaveLength(2);
      for (const inv of paidInvoices) {
        expect(inv.status).toBe("PAID");
        expect(inv.id).toMatch(/^invoice-history-/);
      }
      // Dana late_count=1, marcus late_count=3
      const dana = database.$client
        .prepare("SELECT late_count FROM clients WHERE persona = 'dana'")
        .get() as { late_count: number };
      expect(dana.late_count).toBe(1);
      const marcus = database.$client
        .prepare("SELECT late_count FROM clients WHERE persona = 'marcus'")
        .get() as { late_count: number };
      expect(marcus.late_count).toBe(3);
    } finally {
      closeTestDb(database);
    }
  });

  it("all overdue invoices have status OVERDUE, paid_cents 0, and chase_state NEW", async () => {
    const database = createTestDb();
    try {
      await seedDatabase(database, { paypalMode: "mock" }, DEMO_NOW);
      const overdue = database.$client
        .prepare("SELECT status, paid_cents, chase_state FROM invoices WHERE status = 'OVERDUE'")
        .all() as { status: string; paid_cents: number; chase_state: string }[];
      expect(overdue).toHaveLength(5);
      for (const inv of overdue) {
        expect(inv.status).toBe("OVERDUE");
        expect(inv.paid_cents).toBe(0);
        expect(inv.chase_state).toBe("NEW");
      }
    } finally {
      closeTestDb(database);
    }
  });
});

describe("seedIfEmpty (D56)", () => {
  it("seeds the DB when the invoices table is empty and returns true", async () => {
    const { seedIfEmpty } = await import("./seed");
    const database = createTestDb();
    try {
      const result = await seedIfEmpty(database, { paypalMode: "mock" });
      expect(result).toBe(true);
      const count = (database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get() as { count: number }).count;
      expect(count).toBeGreaterThan(0);
    } finally {
      closeTestDb(database);
    }
  });

  it("skips seeding when invoices already exist and returns false", async () => {
    const { seedIfEmpty } = await import("./seed");
    const database = createTestDb();
    try {
      // First call seeds
      await seedIfEmpty(database, { paypalMode: "mock" });
      const countAfterFirst = (database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get() as { count: number }).count;

      // Second call must skip — count must not change
      const result = await seedIfEmpty(database, { paypalMode: "mock" });
      expect(result).toBe(false);
      const countAfterSecond = (database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get() as { count: number }).count;
      expect(countAfterSecond).toBe(countAfterFirst);
    } finally {
      closeTestDb(database);
    }
  });

  it("preserves webhook history when adding invoices to an empty workspace", async () => {
    const { seedIfEmpty } = await import("./seed");
    const database = createTestDb();
    try {
      database.$client.prepare(
        "INSERT INTO webhook_events (id, event_type, payload_json, received_at) VALUES (?, ?, ?, ?)",
      ).run("existing-event", "INVOICING.INVOICE.CREATED", "{}", "2026-11-10T00:00:00.000Z");

      expect(await seedIfEmpty(database, { paypalMode: "mock" })).toBe(true);
      expect(database.$client.prepare("SELECT id FROM webhook_events").all())
        .toEqual([{ id: "existing-event" }]);
    } finally {
      closeTestDb(database);
    }
  });
});
