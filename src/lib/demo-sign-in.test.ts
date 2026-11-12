import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLIENT_ACCOUNTS, isDemoClientEmail } from "./demo-accounts";

const state = vi.hoisted(() => ({ sessionEmail: null as string | null, forwarded: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, refresh: () => undefined, push: () => undefined }), redirect: () => { throw new Error("redirected"); } }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({
  GET: async () => new Response("ok"),
  POST: async (request: Request) => { state.forwarded.push(new URL(request.url).pathname); return new Response("ok"); },
}) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => state.sessionEmail ? { user: { email: state.sessionEmail } } : null } },
  ensureAuthSchema: async () => undefined,
  getAuthReadiness: () => ({ ready: true, missing: [], testingSender: false }),
  authNotConfiguredResponse: () => new Response(null, { status: 503 }),
  getOwnerAccountExists: async () => true,
}));
vi.mock("@/lib/env", async (original) => ({ ...await original<typeof import("@/lib/env")>(), getAuthEnv: () => ({ ownerEmail: "owner@example.test" }) }));
vi.mock("@/lib/db/client", () => ({ db: { $client: {} } }));

afterEach(() => { state.sessionEmail = null; state.forwarded.length = 0; });

describe("Click for demo", () => {
  it("offers the published demo client only when the page passes it", async () => {
    const { ClientLoginForm } = await import("@/components/client-portal");
    const demo = DEMO_CLIENT_ACCOUNTS[0];
    const withDemo = renderToStaticMarkup(createElement(ClientLoginForm, { demo }));
    expect(withDemo).toContain("Click for demo");
    expect(withDemo).toContain("Signs you in as Dana Whitfield, a fictional client");
    expect(renderToStaticMarkup(createElement(ClientLoginForm, {}))).not.toContain("Click for demo");
    expect(demo.email.endsWith("@example.com")).toBe(true);
    expect(isDemoClientEmail(" DANA.demo@example.com ")).toBe(true);
  });

  it("shows the owner demo button on the sign-in preview only", async () => {
    const { LoginForm } = await import("@/components/login-form");
    const base = { authConfigured: true, ownerAccountExists: true, testingSender: false, emailVerified: false };
    expect(renderToStaticMarkup(createElement(LoginForm, { ...base, previewOnly: true, demoDisplay: { email: "maya@example.com", maskedPassword: "••••" } }))).toContain("Click for demo");
    expect(renderToStaticMarkup(createElement(LoginForm, base))).not.toContain("Click for demo");
  });
});

describe("account changes through the auth API", () => {
  const post = async (path: string, body: unknown = {}) => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    return POST(new Request(`http://localhost/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  };

  it("refuses password, email and session changes for client sessions, including the demo account", async () => {
    state.sessionEmail = DEMO_CLIENT_ACCOUNTS[0].email;
    for (const path of ["/change-password", "/update-user", "/revoke-sessions", "/two-factor/enable", "/delete-user"]) {
      expect((await post(path)).status).toBe(403);
    }
    expect(state.forwarded).toEqual([]);
    expect((await post("/sign-out")).status).toBe(200); // signing out still works
  });

  it("lets the owner manage their own account and blocks resetting the demo password", async () => {
    state.sessionEmail = "owner@example.test";
    expect((await post("/change-password")).status).toBe(200);
    state.sessionEmail = null;
    expect((await post("/request-password-reset", { email: DEMO_CLIENT_ACCOUNTS[0].email })).status).toBe(403);
    expect((await post("/request-password-reset", { email: "owner@example.test" })).status).toBe(200);
  });
});
