import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(async () => false),
  runAutopilot: vi.fn(async (trigger: string) => ({ ran: trigger === "manual", reason: trigger === "manual" ? undefined : "autopilot_off", dueCount: 2, results: [], failed: [] })),
}));
vi.mock("@/lib/auth", () => ({ isDemoRequestAuthenticated: mocks.authenticated, unauthorizedResponse: () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }) }));
vi.mock("@/lib/autopilot", () => ({ runAutopilot: mocks.runAutopilot }));

import { POST } from "@/app/api/agent/run-due/route";

const SECRET = "a-long-shared-secret-for-tests";
const original = process.env.CRON_SECRET;

function post(headers: Record<string, string> = {}, body = "{}"): Request {
  return new Request("http://localhost/api/agent/run-due", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  mocks.authenticated.mockReset().mockResolvedValue(false);
  mocks.runAutopilot.mockClear();
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original;
});

describe("run-due route", () => {
  it("rejects anonymous calls and wrong or missing cron secrets", async () => {
    expect((await POST(post())).status).toBe(401);
    expect((await POST(post({ "x-chaser-cron-secret": "nope" }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await POST(post({ "x-chaser-cron-secret": SECRET }))).status).toBe(401);
    expect(mocks.runAutopilot).not.toHaveBeenCalled();
  });

  it("treats a valid cron secret as a scheduled trigger and a session as a manual one", async () => {
    const scheduled = await POST(post({ "x-chaser-cron-secret": SECRET }));
    expect(scheduled.status).toBe(200);
    await expect(scheduled.json()).resolves.toMatchObject({ ran: false, reason: "autopilot_off", dueCount: 2 });
    mocks.authenticated.mockResolvedValue(true);
    const manual = await POST(post());
    await expect(manual.json()).resolves.toMatchObject({ ran: true, dueCount: 2 });
    expect(mocks.runAutopilot.mock.calls.map(([trigger]) => trigger)).toEqual(["schedule", "manual"]);
  });

  it("still validates the body", async () => {
    expect((await POST(post({ "x-chaser-cron-secret": SECRET }, "{bad"))).status).toBe(400);
    expect((await POST(post({ "x-chaser-cron-secret": SECRET }, '{"invoiceId":"x"}'))).status).toBe(400);
  });
});
