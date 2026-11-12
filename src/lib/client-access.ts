// Client sign-in (D77). A client user is an ordinary Better Auth user whose email is listed in
// client_accounts. Clients see only their own invoices; the owner workspace never accepts them.
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auth, ensureAuthSchema } from "./auth";
import { db, type AppDb } from "./db/client";
import { clientAccounts } from "./db/schema";
import { getClient, getMessages, listInvoices, listPlansByInvoiceId } from "./db/queries";
import { getAuthEnv } from "./env";
import type { ChatMessage, ClientRow, InvoiceRow, PlanRow } from "./types";

export interface ClientSession {
  email: string;
  clientId: string;
  clientName: string;
}

export function findClientIdForEmail(email: string, database: AppDb = db): string | null {
  const row = database.select({ clientId: clientAccounts.clientId }).from(clientAccounts)
    .where(eq(clientAccounts.email, email.trim().toLowerCase())).get();
  return row?.clientId ?? null;
}

/** The signed-in client, or null. The owner's account is never treated as a client. */
export async function getClientSession(database: AppDb = db): Promise<ClientSession | null> {
  await ensureAuthSchema();
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user.emailVerified) return null;
  const email = session.user.email.toLowerCase();
  if (email === getAuthEnv().ownerEmail) return null;
  const clientId = findClientIdForEmail(email, database);
  const client = clientId ? getClient(clientId, database) : null;
  return client ? { email, clientId: client.id, clientName: client.name } : null;
}

export function clientOwnsInvoice(clientId: string, invoiceId: string, database: AppDb = db): boolean {
  return listInvoices(database).some(({ invoice }) => invoice.id === invoiceId && invoice.clientId === clientId);
}

export interface ClientPortalInvoice {
  invoice: InvoiceRow;
  installments: InvoiceRow[];
  plan: PlanRow | null;
  /** Only what passed between Chaser and the client; internal notes stay with the owner. */
  messages: ChatMessage[];
}

/** Everything one client may see: their own open and settled invoices, plans and conversation. */
export function loadClientPortal(clientId: string, database: AppDb = db): { client: ClientRow; invoices: ClientPortalInvoice[] } | null {
  const client = getClient(clientId, database);
  if (!client) return null;
  const own = listInvoices(database).map(({ invoice }) => invoice).filter((invoice) => invoice.clientId === clientId && invoice.status !== "CANCELLED");
  const roots = own.filter((invoice) => !invoice.parentInvoiceId);
  return {
    client,
    invoices: roots.map((invoice) => ({
      invoice,
      installments: own.filter((row) => row.parentInvoiceId === invoice.id).sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0)),
      plan: listPlansByInvoiceId(invoice.id, database).find((plan) => plan.status !== "REJECTED" && plan.status !== "EXPIRED") ?? null,
      messages: getMessages(invoice.id, database).filter((message) => message.direction === "agent_to_client" || message.direction === "client_to_agent"),
    })),
  };
}
