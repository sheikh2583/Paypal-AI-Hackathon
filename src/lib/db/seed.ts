import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getPayPalEnv } from "../env";
import { getNow } from "../clock";
import type { AppDb } from "./client";
import { db } from "./client";
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

const clientSeed = [
  {
    id: "client-elena",
    name: "Elena Martinez",
    persona: "A returning client who wants a payment plan for a large invoice.",
    responsiveness: "medium" as const,
    notes: "Has a history of paying late but communicating clearly.",
    lateCount: 1,
    avgDaysLate: 12,
    historyInvoice: { id: "invoice-history-elena", number: "CH-2026-001", amountCents: 120000, daysOverdue: 82, daysLate: 12 },
  },
  {
    id: "client-priya",
    name: "Priya Shah",
    persona: "A client who asks for a steep discount when cash flow is tight.",
    responsiveness: "medium" as const,
    notes: "Requested a 40% discount; route the request through policy and owner review.",
    lateCount: 1,
    avgDaysLate: 21,
    historyInvoice: { id: "invoice-history-priya", number: "CH-2026-002", amountCents: 68000, daysOverdue: 104, daysLate: 21 },
  },
  {
    id: "client-marcus",
    name: "Marcus Lee",
    persona: "A small business client who responds promptly to friendly reminders.",
    responsiveness: "high" as const,
    notes: null,
    lateCount: 0,
    avgDaysLate: 0,
  },
  {
    id: "client-olivia",
    name: "Olivia Chen",
    persona: "A freelancer who usually needs a short extension before paying.",
    responsiveness: "medium" as const,
    notes: null,
    lateCount: 0,
    avgDaysLate: 0,
  },
  {
    id: "client-noah",
    name: "Noah Williams",
    persona: "A quiet client who benefits from clear, concise follow-ups.",
    responsiveness: "low" as const,
    notes: null,
    lateCount: 0,
    avgDaysLate: 0,
  },
] as const;

const overdueInvoiceSeed: SeedInvoice[] = [
  {
    id: "invoice-elena-2400",
    clientId: "client-elena",
    number: "CH-2026-101",
    description: "Custom bakery order and event catering",
    amountCents: 240000,
    daysOverdue: 23,
  },
  {
    id: "invoice-priya-1800",
    clientId: "client-priya",
    number: "CH-2026-102",
    description: "Monthly bookkeeping and cash-flow support",
    amountCents: 180000,
    daysOverdue: 31,
  },
  {
    id: "invoice-marcus-960",
    clientId: "client-marcus",
    number: "CH-2026-103",
    description: "Website maintenance and hosting",
    amountCents: 96000,
    daysOverdue: 14,
  },
  {
    id: "invoice-olivia-1250",
    clientId: "client-olivia",
    number: "CH-2026-104",
    description: "Brand identity design work",
    amountCents: 125000,
    daysOverdue: 9,
  },
  {
    id: "invoice-noah-540",
    clientId: "client-noah",
    number: "CH-2026-105",
    description: "Product photography session",
    amountCents: 54000,
    daysOverdue: 5,
  },
];

export interface SeededInvoiceSummary {
  client: string;
  number: string;
  amountCents: number;
  daysOverdue: number;
}

export interface SeedOptions {
  paypalMode?: "mock" | "sandbox";
  sandboxBuyerEmail?: string;
}

function isoAtDaysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export function seedDatabase(
  database: AppDb = db,
  options: SeedOptions = {},
  suppliedNow?: Date,
): SeededInvoiceSummary[] {
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

  database.$client.exec(`
    DELETE FROM messages;
    DELETE FROM approvals;
    DELETE FROM audit_log;
    DELETE FROM webhook_events;
    DELETE FROM mock_paypal_invoices;
    DELETE FROM plans;
    DELETE FROM invoices;
    DELETE FROM clients;
    DELETE FROM owner_policy;
    DELETE FROM kv;
  `);

  const now = suppliedNow ?? getNow();
  const clientEmail = (id: string) =>
    paypalMode === "sandbox"
      ? sandboxBuyerEmail!
      : `${id.replace(/^client-/, "").replaceAll("-", ".")}@example.com`;

  database
    .insert(ownerPolicy)
    .values({
      id: "default",
      minDepositPercent: 20,
      maxInstallments: 6,
      maxPlanDays: 180,
      maxDiscountPercent: 10,
      autoApproveBelowCents: 100000,
      tone: "friendly",
      businessName: "Dana's Bakery",
      ownerName: "Dana",
    })
    .run();

  database
    .insert(clients)
    .values(clientSeed.map((client) => ({ ...client, email: clientEmail(client.id) })))
    .run();

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

  const historyRows = clientSeed.flatMap((client) => {
    if (!("historyInvoice" in client) || !client.historyInvoice) return [];
    const history = client.historyInvoice;
    const localId = history.id;
    return [{
      id: localId,
      paypalInvoiceId: paypalMode === "mock" ? `mock-${localId}` : null,
      paypalInvoiceUrl: paypalMode === "mock" ? `http://localhost:3000/mock-paypal/invoice/mock-${localId}` : null,
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
    }];
  });
  const allInvoices = [...invoiceRows, ...historyRows];

  database
    .insert(invoices)
    .values(allInvoices)
    .run();

  const messageRows = allInvoices.map((invoice) => ({
    id: `message-sent-${invoice.id}`,
    invoiceId: invoice.id,
    direction: "system" as const,
    body: "Invoice sent",
    createdAt: invoice.issuedAt,
  }));
  database.insert(messages).values(messageRows).run();

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

  return overdueInvoiceSeed.map((invoice) => ({
    client: clientSeed.find((client) => client.id === invoice.clientId)!.name,
    number: invoice.number,
    amountCents: invoice.amountCents,
    daysOverdue: Math.floor((now.getTime() - new Date(isoAtDaysBefore(now, invoice.daysOverdue)).getTime()) / DAY_MS),
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summaries = seedDatabase();
  console.log(`Seeded ${summaries.length} overdue invoices.`);
  for (const invoice of summaries) {
    console.log(`${invoice.client} | ${invoice.number} | ${invoice.amountCents} cents | ${invoice.daysOverdue} days overdue`);
  }
}
