import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "./types";
import { messageSources } from "./message-source";

const entry = (at: string, action: string, fields: Partial<AuditEntry> = {}): AuditEntry => ({ id: `${action}-${at}`, at, actor: "agent", action, invoiceId: "i", input: {}, result: {}, ok: true, ...fields });

describe("who wrote each Chaser message", () => {
  it("marks messages from a run the model answered as live and fallback or script runs as scripted", () => {
    const sources = messageSources([
      // Run 1: the model answered, then sent message m1.
      entry("2026-11-12T10:00:01Z", "llm.call", { actor: "system", input: { purpose: "agent_run", keyNumber: 2 } }),
      entry("2026-11-12T10:00:02Z", "send_message", { result: { ok: true, messageId: "m1" } }),
      entry("2026-11-12T10:00:03Z", "agent_run", { input: { runId: "r1", startedAt: "2026-11-12T10:00:00Z" } }),
      // Run 2: the provider failed and the script took over before m2.
      entry("2026-11-12T10:01:01Z", "llm.call", { actor: "system", ok: false, input: { purpose: "agent_run" } }),
      entry("2026-11-12T10:01:02Z", "llm.fallback"),
      entry("2026-11-12T10:01:03Z", "send_message", { result: { ok: true, messageId: "m2" } }),
      entry("2026-11-12T10:01:04Z", "agent_run", { input: { runId: "r2", startedAt: "2026-11-12T10:01:00Z" } }),
      // Run 3: scripted mode, no model call at all.
      entry("2026-11-12T10:02:01Z", "send_message", { result: { ok: true, messageId: "m3" } }),
      entry("2026-11-12T10:02:02Z", "agent_run", { input: { runId: "r3", startedAt: "2026-11-12T10:02:00Z" } }),
      // Sent outside any agent run (the owner's relayed counter): no label.
      entry("2026-11-12T10:03:00Z", "send_message", { result: { ok: true, messageId: "m4" } }),
    ]);
    expect(Object.fromEntries(sources)).toEqual({ m1: "live", m2: "scripted", m3: "scripted" });
  });
});

describe("the required tool", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is forced on the first request only, so the model can go on to confirm", async () => {
    const { OpenAICompatibleLLM } = await import("./llm");
    const { KeyPool } = await import("./llm-pool");
    const bodies: Record<string, unknown>[] = [];
    const replies = [
      { tool_calls: [{ id: "t1", type: "function", function: { name: "create_plan_invoices", arguments: "{}" } }] },
      { content: "Done." },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: replies.shift() }] }), { status: 200 });
    }));
    const llm = new OpenAICompatibleLLM("https://provider.test/v1", "k", "m", { pool: new KeyPool(1, ["m"], Date.now, () => undefined) });
    await llm.runToolLoop({ system: "s", messages: [{ role: "user", content: "go" }], tools: [{ name: "create_plan_invoices", description: "d", inputSchema: { type: "object" } }], maxIterations: 3, toolChoiceName: "create_plan_invoices", onToolCall: async () => "{}" });
    expect(bodies[0].tool_choice).toEqual({ type: "function", function: { name: "create_plan_invoices" } });
    expect(bodies[1]).not.toHaveProperty("tool_choice");
  });
});
