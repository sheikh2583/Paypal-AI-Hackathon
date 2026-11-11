import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getAppEnv, getDatabaseEnv, getPayPalEnv } from "../env";
import { getNow } from "../clock";
import type { AppDb } from "./client";
import { db } from "./client";
import { refreshRisk } from "../risk/service";
import { clients, invoices, kv, messages, mockPaypalInvoices, ownerPolicy } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedInvoice {
  id: string;
  clientId: string;
  number: string;
  description: string;
  amountCents: number;
  daysOverdue: number;
}

// ---------------------------------------------------------------------------
// Client definitions — persona keys match docs/07 exactly.
// Choices where docs/07 is silent (D-numbers logged in DECISIONS.md):
//   - dana: avg_days_late=8 (single late invoice, moderate delay)
//   - marcus: avg_days_late=22 (3 late invoices, low responsiveness, chronic)
//   - priya/tom: avg_days_late=0 (late_count=0, no history)
//   - elena: avg_days_late=0 (no stated late history, first overdue scenario)
//   - All medium-responsiveness clients default to "medium" per the risk table
//   - priya: responsiveness medium (doc silent; chosen as neutral for demo)
//   - tom: responsiveness medium (doc silent; chosen as neutral)
//   - elena: responsiveness medium (doc silent; large invoice, above threshold)
// ---------------------------------------------------------------------------

const clientSeed = [
  {
    id: "client-dana",
    name: "Dana Whitfield",
    persona: "dana",
    responsiveness: "high" as const,
    notes: "Owner of Bright Path Bakery. Had one late invoice; generally responds promptly.",
    lateCount: 1,
    avgDaysLate: 8,
    // One paid history invoice so late_count/avg_days_late make sense
    historyInvoice: {
      id: "invoice-history-dana",
      number: "CH-2026-001",
      amountCents: 60000,  // $600 earlier design work
      daysOverdue: 75,
      daysLate: 8,
    },
  },
  {
    id: "client-marcus",
    name: "Marcus Lee",
    persona: "marcus",
    responsiveness: "low" as const,
    notes: "Owner of Lee Logistics. Chronic late payer; low responsiveness to follow-ups.",
    lateCount: 3,
    avgDaysLate: 22,
    // Two paid history invoices to back up late_count=3 (third is current overdue)
    historyInvoice: {
      id: "invoice-history-marcus",
      number: "CH-2026-002",
      amountCents: 80000,  // $800 earlier work
      daysOverdue: 120,
      daysLate: 25,
    },
  },
  {
    id: "client-priya",
    name: "Priya Nair",
    persona: "priya",
    responsiveness: "medium" as const,
    notes: "Owner of Nair Wellness. First late invoice; no prior history.",
    lateCount: 0,
    avgDaysLate: 0,
  },
  {
    id: "client-tom",
    name: "Tom Brennan",
    persona: "tom",
    responsiveness: "medium" as const,
    notes: "Owner of Brennan Tools. New client; first late invoice.",
    lateCount: 0,
    avgDaysLate: 0,
  },
  {
    id: "client-elena",
    name: "Elena Cruz",
    persona: "elena",
    responsiveness: "medium" as const,
    notes: "Owner of Cruz Interiors. Large invoice above auto-approve threshold; demonstrates owner sign-off flow.",
    lateCount: 0,
    avgDaysLate: 0,
  },
] as const;

// Overdue invoices — amounts and days match docs/07 exactly.
// Total: $900 + $1,250 + $600 + $350 + $2,400 = $5,500
const overdueInvoiceSeed: SeedInvoice[] = [
  {
    id: "invoice-dana-900",
    clientId: "client-dana",
    number: "CH-2026-101",
    description: "Brand identity package",
    amountCents: 90000,   // $900
    daysOverdue: 23,
  },
  {
    id: "invoice-marcus-1250",
    clientId: "client-marcus",
    number: "CH-2026-102",
    description: "Website refresh",
    amountCents: 125000,  // $1,250
    daysOverdue: 41,
  },
  {
    id: "invoice-priya-600",
    clientId: "client-priya",
    number: "CH-2026-103",
    description: "Social media kit",
    amountCents: 60000,   // $600
    daysOverdue: 12,
  },
  {
    id: "invoice-tom-350",
    clientId: "client-tom",
    number: "CH-2026-104",
    description: "Logo update",
    amountCents: 35000,   // $350
    daysOverdue: 6,
  },
  {
    id: "invoice-elena-2400",
    clientId: "client-elena",
    number: "CH-2026-105",
    description: "Catalog design",
    amountCents: 240000,  // $2,400 — above auto-approve threshold of $1,500
    daysOverdue: 18,
  },
];

export interface SeededInvoiceSummary {
  client: string;
  persona: string;
  number: string;
  amountCents: number;
  daysOverdue: number;
}

export interface SeedOptions {
  paypalMode?: "mock" | "sandbox";
  sandboxBuyerEmail?: string;
}

const businessTables = [
  "messages", "approvals", "audit_log", "webhook_events", "mock_paypal_invoices",
  "plans", "invoices", "clients", "owner_policy", "kv",
] as const;

function isoAtDaysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function seedDatabase(
  database: AppDb = db,
  options: SeedOptions = {},
  suppliedNow?: Date,
): Promise<SeededInvoiceSummary[]> {
  if (database === db && getDatabaseEnv().mode === "turso") {
    throw new Error("Full demo reset is unavailable on the hosted Turso database.");
  }
  return replaceBusinessSeed(database, options, suppliedNow);
}

export async function resetPublicDemoSeed(database: AppDb, options: SeedOptions): Promise<SeededInvoiceSummary[]> {
  if (!getAppEnv().demoPublic) throw new Error("Public demo reset is disabled.");
  return replaceBusinessSeed(database, options);
}

async function replaceBusinessSeed(database: AppDb, options: SeedOptions, suppliedNow?: Date) {
  const seed = database.$client.transaction(() => {
    const resetTables = businessTables.filter((table) => table !== "kv");
    database.$client.exec(resetTables.map((table) => `DELETE FROM ${table};`).join("\n"));
    // Keep PayPal reset-cancellation correlation across demo resets, but clear demo clock state.
    database.$client.exec("DELETE FROM kv WHERE key != 'paypal_reset_cleanup';");
    return insertSeedRows(database, options, suppliedNow);
  }).immediate();
  return refreshSeededInvoices(database, seed);
}

function insertSeedRows(database: AppDb, options: SeedOptions, suppliedNow?: Date) {
  const paypalEnv =
    options.paypalMode === undefined ||
    (options.paypalMode === "sandbox" && options.sandboxBuyerEmail === undefined)
      ? getPayPalEnv()
      : undefined;
  const paypalMode = options.paypalMode ?? paypalEnv!.mode;
  const sandboxBuyerEmail = options.sandboxBuyerEmail ?? paypalEnv?.buyerEmail;
  if (paypalMode === "sandbox" && !sandboxBuyerEmail) {
    throw new Error("PAYPAL_SANDBOX_BUYER_EMAIL is required when seeding in sandbox mode");
  }

  const now = suppliedNow ?? getNow(database);
  const seedAt = now.toISOString();

  // Sandbox mode: every client gets the sandbox buyer email so invoices reach
  // the PayPal buyer account. Otherwise use clearly fictional @example.com addresses.
  const clientEmail = (persona: string) =>
    paypalMode === "sandbox"
      ? sandboxBuyerEmail!
      : `${persona}@example.com`;

  // Owner policy — exact values from docs/07
  database
    .insert(ownerPolicy)
    .values({
      id: "default",
      minDepositPercent: 30,
      maxInstallments: 3,
      maxPlanDays: 90,
      maxDiscountPercent: 5,
      autoApproveBelowCents: 150000,  // $1,500 — Elena's $2,400 is above this
      tone: "friendly",
      businessName: "Rahman Design Studio",
      ownerName: "Maya Rahman",
      updatedAt: seedAt,
    })
    .run();

  // Clients
  database
    .insert(clients)
    .values(
      clientSeed.map((client) => ({
        id: client.id,
        name: client.name,
        email: clientEmail(client.persona),
        persona: client.persona,
        lateCount: client.lateCount,
        avgDaysLate: client.avgDaysLate,
        responsiveness: client.responsiveness,
        notes: client.notes,
      })),
    )
    .run();

  // Build overdue invoice rows
  const invoiceRows = overdueInvoiceSeed.map((seed) => ({
    id: seed.id,
    paypalInvoiceId: paypalMode === "mock" ? `mock-${seed.id}` : null,
    paypalInvoiceUrl:
      paypalMode === "mock" ? `http://localhost:3000/mock-paypal/invoice/mock-${seed.id}` : null,
    clientId: seed.clientId,
    number: seed.number,
    description: seed.description,
    amountCents: seed.amountCents,
    paidCents: 0,
    currency: "USD" as const,
    issuedAt: isoAtDaysBefore(now, seed.daysOverdue + 30),
    dueAt: isoAtDaysBefore(now, seed.daysOverdue),
    status: "OVERDUE" as const,
    parentInvoiceId: null,
    planId: null,
    installmentNo: null,
    chaseState: "NEW" as const,
    riskScore: null,
    riskFactorsJson: "[]",
    riskExplanation: null,
    lastAgentRunAt: null,
    nextFollowupAt: null,
  }));

  // Build paid history invoice rows — give clients with lateCount > 0 a paid past invoice
  const historyRows = clientSeed.flatMap((client) => {
    if (!("historyInvoice" in client) || !client.historyInvoice) return [];
    const history = client.historyInvoice;
    return [
      {
        id: history.id,
        paypalInvoiceId: paypalMode === "mock" ? `mock-${history.id}` : null,
        paypalInvoiceUrl:
          paypalMode === "mock"
            ? `http://localhost:3000/mock-paypal/invoice/mock-${history.id}`
            : null,
        clientId: client.id,
        number: history.number,
        description: "Earlier completed service invoice",
        amountCents: history.amountCents,
        paidCents: history.amountCents,
        currency: "USD" as const,
        issuedAt: isoAtDaysBefore(now, history.daysOverdue + 30),
        dueAt: isoAtDaysBefore(now, history.daysOverdue),
        status: "PAID" as const,
        parentInvoiceId: null,
        planId: null,
        installmentNo: null,
        chaseState: "RESOLVED" as const,
        riskScore: null,
        riskFactorsJson: "[]",
        riskExplanation: null,
        lastAgentRunAt: null,
        nextFollowupAt: null,
      },
    ];
  });

  const allInvoices = [...invoiceRows, ...historyRows];

  database.insert(invoices).values(allInvoices).run();

  // "Invoice sent" system message for every invoice
  const messageRows = allInvoices.map((invoice) => ({
    id: `message-sent-${invoice.id}`,
    invoiceId: invoice.id,
    direction: "system" as const,
    body: "Invoice sent",
    createdAt: invoice.issuedAt,
  }));
  database.insert(messages).values(messageRows).run();

  // Mock PayPal rows for every invoice when in mock mode
  if (paypalMode === "mock") {
    database
      .insert(mockPaypalInvoices)
      .values(
        allInvoices.map((invoice) => ({
          id: `mock-${invoice.id}`,
          number: invoice.number,
          amountCents: invoice.amountCents,
          paidCents: invoice.paidCents,
          status: invoice.status,
          recipientViewUrl: `http://localhost:3000/mock-paypal/invoice/mock-${invoice.id}`,
          createdAt: invoice.issuedAt,
        })),
      )
      .run();
  }

  database.insert(kv).values({ key: "clock_offset_days", value: "0" }).run();

  return { allInvoices, now };
}

async function refreshSeededInvoices(
  database: AppDb,
  { allInvoices, now }: ReturnType<typeof insertSeedRows>,
): Promise<SeededInvoiceSummary[]> {
  for (const invoice of allInvoices) {
    await refreshRisk(invoice.id, database, now);
  }

  return overdueInvoiceSeed.map((invoice) => {
    const client = clientSeed.find((c) => c.id === invoice.clientId)!;
    return {
      client: client.name,
      persona: client.persona,
      number: invoice.number,
      amountCents: invoice.amountCents,
      daysOverdue: Math.floor(
        (now.getTime() - new Date(isoAtDaysBefore(now, invoice.daysOverdue)).getTime()) / DAY_MS,
      ),
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void seedDatabase().then((summaries) => {
    console.log(`Seeded ${summaries.length} overdue invoices.`);
    for (const invoice of summaries) {
      console.log(
        `${invoice.client} (${invoice.persona}) | ${invoice.number} | $${(invoice.amountCents / 100).toFixed(2)} | ${invoice.daysOverdue}d overdue`,
      );
    }
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Seed failed');
    process.exitCode = 1;
  });
}

/**
 * Seed only when the invoices table is empty.
 * Safe to call on every startup: never reseeds a database that already has data.
 * Returns true when seeding ran, false when skipped.
 */
export async function seedIfEmpty(
  database: AppDb = db,
  options: SeedOptions = {},
): Promise<boolean> {
  const seed = database.$client.transaction(() => {
    const row = database.$client.prepare("SELECT COUNT(*) AS count FROM invoices").get() as { count: number };
    if (row.count > 0) {
      console.log(`seedIfEmpty: ${row.count} invoice(s) already present — skipping seed.`);
      return;
    }
    const remainingTables = businessTables.filter((table) => table !== "invoices");
    const hasRows = remainingTables.map((table) => `SELECT 1 FROM ${table}`).join(" UNION ALL ");
    const leftovers = database.$client.prepare(`SELECT EXISTS(${hasRows}) AS present`).get() as { present: number };
    if (leftovers.present) {
      console.warn("seedIfEmpty: invoices is empty but other business tables contain records. Skipping seed to preserve them.");
      return;
    }
    return insertSeedRows(database, options);
  }).immediate();
  if (!seed) return false;
  const summaries = await refreshSeededInvoices(database, seed);
  console.log(`seedIfEmpty: seeded ${summaries.length} overdue invoices.`);
  return true;
}
