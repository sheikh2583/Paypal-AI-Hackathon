import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { computeReliability } from "./reliability";
import type { ReliabilityEvent, ReliabilityInvoice } from "./types";

const now = new Date("2026-11-11T12:00:00Z");
const clients = [{ id: "a", name: "Zoe" }, { id: "b", name: "Avery" }, { id: "c", name: "Cameron" }];
const invoice = (id: string, clientId: string, fields: Partial<ReliabilityInvoice> = {}): ReliabilityInvoice => ({
  id, clientId, dueAt: "2026-11-05", amountCents: 10_001, paidCents: 0, status: "SENT", ...fields,
});
const paid = (id: string, clientId: string, fields: Partial<ReliabilityInvoice> = {}) =>
  invoice(id, clientId, { status: "PAID", paidCents: 10_001, ...fields });
const observed = (invoiceId: string, at: string): ReliabilityEvent => ({ kind: "payment_observed", invoiceId, at });

describe("client reliability", () => {
  it("ranks faster payers first and treats the UTC due day as on time", () => {
    const results = computeReliability(clients, [paid("a", "a"), paid("b", "b"), invoice("c", "c")], [], [
      observed("a", "2026-11-05T23:59:59Z"),
      observed("b", "2026-11-08T10:00:00Z"),
    ], now);
    expect(results.map(({ client, rank, avgDaysLate }) => [client.id, rank, avgDaysLate]))
      .toEqual([["a", 1, 0], ["b", 2, 3], ["c", 3, 6]]);
    expect(results[0]).toMatchObject({ score: 100, grade: "A" });
  });

  it("breaks equal scores by outstanding cents and then name", () => {
    const rows = [
      paid("a", "a"), paid("b", "b"), paid("c", "c"),
      invoice("b-future", "b", { dueAt: "2026-12-01", amountCents: 1 }),
    ];
    const results = computeReliability(clients, rows, [], [], now);
    expect(results.map(({ client }) => client.id)).toEqual(["c", "a", "b"]);
    expect(new Set(results.map(({ score }) => score))).toEqual(new Set([100]));
  });

  it("leaves clients with only future or cancelled obligations unranked and omits undated timing", () => {
    const results = computeReliability(clients, [
      invoice("future", "a", { dueAt: "2026-12-01" }),
      invoice("cancelled", "b", { status: "CANCELLED" }),
      paid("history", "c"),
    ], [], [], now);
    expect(results[0]).toMatchObject({ rank: 1, avgDaysLate: null, breakdown: {
      timeliness: { points: null }, planAdherence: { points: null },
    } });
    expect(results.slice(1).every(({ rank, grade, score }) => rank === null && grade === null && score === null)).toBe(true);
  });

  it("ranks a plan paid on time above a late plan and skips future installments", () => {
    const installments = [
      paid("a1", "a"), paid("b1", "b"),
      invoice("a2", "a", { dueAt: "2026-12-01" }),
      invoice("b2", "b", { dueAt: "2026-12-01" }),
    ];
    const results = computeReliability(clients, [], installments, [
      observed("a1", "2026-11-04T20:00:00Z"),
      observed("b1", "2026-11-10T20:00:00Z"),
    ], now);
    expect(results.map(({ client, breakdown }) => [client.id, breakdown.planAdherence.points]))
      .toEqual([["a", 25], ["b", 0], ["c", null]]);
  });

  it("uses integer cents, excludes superseded originals, and keeps future balances out of overdue share", () => {
    const rows = [
      invoice("original", "a", { amountCents: 90_000, status: "SUPERSEDED" }),
      invoice("b", "b", { amountCents: 3 }),
      invoice("a-future", "a", { dueAt: "2026-12-01", amountCents: 101 }),
    ];
    const results = computeReliability(clients, rows, [
      invoice("a1", "a", { amountCents: 101, paidCents: 100, status: "PARTIALLY_PAID" }),
    ], [], now);
    expect(results.find(({ client }) => client.id === "a")).toMatchObject({
      outstandingCents: 102, breakdown: { exposure: { points: 11.25 }, planAdherence: { points: 0 } },
    });
  });

  it("uses the supplied clock, counts a recorded discount once, and is deterministic", () => {
    const rows = [invoice("a", "a", { dueAt: "2026-11-12" })];
    const event: ReliabilityEvent = { invoiceId: "a", kind: "discount_escalation", at: "2026-11-10T12:00:00Z" };
    expect(computeReliability(clients, rows, [], [event], now).every(({ rank }) => rank === null)).toBe(true);
    const later = new Date("2026-11-14T12:00:00Z");
    const first = computeReliability(clients, rows, [], [event, event], later);
    expect(first[0]).toMatchObject({ rank: 1, avgDaysLate: 2, breakdown: { behaviour: { points: 15 } } });
    expect(computeReliability(clients, rows, [], [event, event], later)).toEqual(first);
  });

  it("has no runtime module imports", () => {
    const source = ts.createSourceFile("reliability.ts",
      readFileSync(new URL("./reliability.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) imports.push(node.getText(source));
      if (ts.isCallExpression(node) && /^(import|require|fetch)$/.test(node.expression.getText(source))) imports.push(node.getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(imports).toEqual([]);
  });
});
