import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, refresh: () => undefined }), redirect: () => { throw new Error("redirected"); } }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

describe("owner sign-in in the public demo", () => {
  it("shows the real sign-in screen with every control disabled and a way back", async () => {
    const { LoginForm } = await import("@/components/login-form");
    const markup = renderToStaticMarkup(createElement(LoginForm, { authConfigured: true, ownerAccountExists: true, testingSender: false, emailVerified: false, previewOnly: true }));
    expect(markup).toContain("Preview: sign-in is turned off in the public demo");
    expect(markup).toMatch(/<fieldset[^>]*\sdisabled=""/);
    expect(markup).toContain("Sign-in is off in the public demo");
    expect(markup).toContain('href="/"');
    expect(markup).not.toContain('href="/forgot-password"');
  });

  it("keeps the working form outside the demo", async () => {
    const { LoginForm } = await import("@/components/login-form");
    const markup = renderToStaticMarkup(createElement(LoginForm, { authConfigured: true, ownerAccountExists: true, testingSender: false, emailVerified: false }));
    expect(markup).not.toContain("Preview: sign-in is turned off");
    expect(markup).not.toMatch(/<fieldset[^>]*\sdisabled=""/);
    expect(markup).toContain("Continue with password");
    expect(markup).toContain('href="/forgot-password"');
  });
});
