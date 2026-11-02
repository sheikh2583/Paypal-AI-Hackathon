import { describe, expect, it } from "vitest";
import { audit } from "../audit";
import { listAudit, upsertWebhookEvent } from "./queries";
import { closeTestDb, createTestDb } from "./test-utils";

describe("database queries", () => {
  it("redacts email and secret-like keys before writing audit entries", () => {
    const database = createTestDb();
    try {
      audit(
        {
          actor: "system",
          action: "test.redaction",
          input: {
            email: "dana@example.com",
            nested: { refresh_token: "do-not-store", note: "reply to person@example.org" },
          },
          result: { authorization: "Bearer hidden", status: "ok" },
          ok: true,
        },
        database,
        "2026-11-02T12:00:00.000Z",
      );

      const [entry] = listAudit(undefined, database);
      expect(entry.input).toEqual({
        email: "d***@example.com",
        nested: { note: "reply to p***@example.org" },
      });
      expect(entry.result).toEqual({ status: "ok" });
    } finally {
      closeTestDb(database);
    }
  });

  it("truncates large audit payloads", () => {
    const database = createTestDb();
    try {
      audit(
        { actor: "system", action: "test.truncate", input: "x".repeat(5_000), ok: true },
        database,
        "2026-11-02T12:00:00.000Z",
      );
      const [entry] = listAudit(undefined, database);
      expect(entry.input).toMatchObject({ truncated: true });
    } finally {
      closeTestDb(database);
    }
  });

  it("deduplicates webhook event ids", () => {
    const database = createTestDb();
    try {
      const event = {
        id: "WH-123",
        eventType: "INVOICING.INVOICE.PAID",
        payload: { resource: { id: "invoice-1" } },
        receivedAt: "2026-11-02T12:00:00.000Z",
      };
      expect(upsertWebhookEvent(event, database)).toBe(true);
      expect(upsertWebhookEvent(event, database)).toBe(false);
    } finally {
      closeTestDb(database);
    }
  });
});
