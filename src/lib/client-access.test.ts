import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, createTestDb } from "./db/test-utils";
import type { AppDb } from "./db/client";
import { seedDatabase } from "./db/seed";
import { insertMessage } from "./db/queries";

const state = vi.hoisted(() => ({ database: undefined as AppDb | undefined, session: null as null | { email: string; clientId: string; clientName: string }, replies: [] as string[] }));
vi.mock("./db/client", async (original) => ({ ...await original<typeof import("./db/client")>(), get db() { return state.database; } }));
vi.mock("./auth", () => ({ auth: { api: { getSession: async () => null } }, ensureAuthSchema: async () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./agent/reply", () => ({ MAX_REPLY_CHARS: 600, replyAsClient: async (invoiceId: string) => { state.replies.push(invoiceId); return { classification: { intent: "unclear", confidence: 0 }, run: { summary: "Answered." } }; } }));

let database: AppDb;
afterEach(() => { if (database) closeTestDb(database); state.session = null; state.replies.length = 0; vi.resetModules(); });

async function seeded(): Promise<void> {
  database = createTestDb();
  state.database = database;
  await seedDatabase(database, { paypalMode: "mock" }, new Date("2026-11-03T00:00:00.000Z"));
  database.$client.prepare("INSERT INTO client_accounts (email, client_id, created_at) VALUES (?, ?, ?)").run("dana@example.test", "client-dana", "2026-11-12T00:00:00Z");
}

describe("client access", () => {
  it("maps a sign-in email to exactly one client, case-insensitively", async () => {
    await seeded();
    const { findClientIdForEmail } = await import("./client-access");
    expect(findClientIdForEmail(" Dana@Example.test ", database)).toBe("client-dana");
    expect(findClientIdForEmail("someone@example.test", database)).toBeNull();
  });

  it("shows a client only their own invoices and only the client-facing messages", async () => {
    await seeded();
    const { loadClientPortal, clientOwnsInvoice } = await import("./client-access");
    insertMessage({ id: "m1", invoiceId: "invoice-dana-900", direction: "agent_to_client", body: "Reminder", createdAt: "2026-11-03T01:00:00Z" }, database);
    insertMessage({ id: "m2", invoiceId: "invoice-dana-900", direction: "owner_note", body: "Internal note", createdAt: "2026-11-03T02:00:00Z" }, database);
    const portal = loadClientPortal("client-dana", database)!;
    expect(portal.invoices.length).toBeGreaterThan(0);
    expect(portal.invoices.every(({ invoice }) => invoice.clientId === "client-dana")).toBe(true);
    expect(portal.invoices.find(({ invoice }) => invoice.id === "invoice-dana-900")!.messages.map(({ body }) => body)).toEqual(["Reminder"]);
    expect(clientOwnsInvoice("client-dana", "invoice-dana-900", database)).toBe(true);
    expect(clientOwnsInvoice("client-dana", "invoice-priya-600", database)).toBe(false);
  });

  it("does not count client users as the owner account", async () => {
    await seeded();
    database.$client.exec('CREATE TABLE "user" (id text PRIMARY KEY, email text NOT NULL)');
    database.$client.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run("u1", "dana@example.test");
    const { countOwnerUsers } = await import("./owner-count");
    expect(countOwnerUsers(database.$client, "owner@example.test")).toBe(0);
    expect(countOwnerUsers(database.$client, undefined)).toBe(0); // the only user is a client
    database.$client.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run("u2", "owner@example.test");
    expect(countOwnerUsers(database.$client, "owner@example.test")).toBe(1);
    expect(countOwnerUsers(database.$client, undefined)).toBe(1);
  });
});

describe("client reply route", () => {
  it("refuses without a client session and hides other clients' invoices", async () => {
    await seeded();
    vi.doMock("@/lib/client-access", async (original) => ({ ...await original<typeof import("./client-access")>(), getClientSession: async () => state.session }));
    const { POST } = await import("@/app/api/client/reply/route");
    const request = (body: unknown) => new Request("http://localhost/api/client/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    expect((await POST(request({ invoiceId: "invoice-dana-900", text: "hi" }))).status).toBe(401);
    state.session = { email: "dana@example.test", clientId: "client-dana", clientName: "Dana Whitfield" };
    expect((await POST(request({ invoiceId: "invoice-priya-600", text: "hi" }))).status).toBe(404);
    expect(state.replies).toEqual([]);
    const ok = await POST(request({ invoiceId: "invoice-dana-900", text: "Can I split this?" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, summary: "Answered." });
    expect(state.replies).toEqual(["invoice-dana-900"]);
  });
});
