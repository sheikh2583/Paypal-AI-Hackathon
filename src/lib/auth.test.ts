import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({ Resend: class ResendMock { emails = { send: sendMock }; } }));

import { authEmailHtml, sendAuthEmail } from "./auth-email";
import type { AuthEnv } from "./env";

const config: AuthEnv = {
  ownerEmail: "owner@example.test",
  baseUrl: "https://example.test",
  secret: "x".repeat(32),
  resendApiKey: "resend-secret-test",
  resendFrom: "PayPal Hackathon <onboarding@resend.dev>",
};

beforeEach(() => sendMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("authentication email", () => {
  it("escapes content in the reusable HTML template", () => {
    const html = authEmailHtml({ to: "owner@example.test", subject: "test", heading: "<script>bad</script>", message: "A & B", actionLabel: "Continue", actionUrl: "https://example.test/?x=\"<bad>", footer: "'" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("uses the official Resend SDK with the configured sender and recipient", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-id" }, error: null });
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "Choose a password", actionLabel: "Reset", actionUrl: "https://example.test/reset" }, config)).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: "PayPal Hackathon <onboarding@resend.dev>",
      to: ["owner@example.test"],
      subject: "Reset",
      html: expect.stringContaining("Choose a password"),
    }));
  });

  it("treats provider errors as failures without leaking the key or provider payload", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "reject resend-secret-test owner@example.test", name: "validation_error" } });
    const log = vi.spyOn(console, "error");
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "OTP", heading: "Code", message: "123456", actionLabel: "Continue", actionUrl: "https://example.test" }, config)).rejects.toThrow("Authentication email provider rejected the request.");
    expect(log).not.toHaveBeenCalled();
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("apiKey");
  });

  it("fails closed with the required environment variable names", async () => {
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "", actionLabel: "Reset", actionUrl: "https://example.test" }, { ...config, resendApiKey: undefined, resendFrom: undefined })).rejects.toThrow(/RESEND_API_KEY and RESEND_FROM/);
  });

  it("rejects links outside the configured app origin", async () => {
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "", actionLabel: "Continue", actionUrl: "https://evil.example/reset" }, config)).rejects.toThrow(/configured application origin/);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
