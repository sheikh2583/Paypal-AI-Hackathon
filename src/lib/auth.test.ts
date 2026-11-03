import { describe, expect, it, vi, afterEach } from "vitest";
import { authEmailHtml, sendAuthEmail } from "./auth-email";

afterEach(() => vi.unstubAllGlobals());

describe("authentication email", () => {
  it("escapes all user and link content in HTML", () => {
    const html = authEmailHtml({ to: "owner@example.test", subject: "test", heading: "<script>bad</script>", message: "A & B", actionLabel: "Continue", actionUrl: "https://example.test/?x=\"<bad>", footer: "'" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("sends through Resend without exposing the API key in failures", async () => {
    const key = "resend-secret-test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("sensitive provider response", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "Choose a password", actionLabel: "Reset", actionUrl: "https://example.test/reset" }, { ownerEmail: "owner@example.test", baseUrl: "https://example.test", secret: "x".repeat(32), resendApiKey: key, emailFrom: "Chaser <noreply@example.test>" })).rejects.toThrow("HTTP 401");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(`Bearer ${key}`);
    expect(fetchMock.mock.calls[0][1].body).not.toContain(key);
    try { await sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "", actionLabel: "Reset", actionUrl: "https://example.test" }, { ownerEmail: "owner@example.test", baseUrl: "https://example.test", secret: "x".repeat(32), resendApiKey: key, emailFrom: "Chaser <noreply@example.test>" }); } catch (error) { expect(String(error)).not.toContain(key); }
  });

  it("fails with configuration variable names and no secret values", async () => {
    await expect(sendAuthEmail({ to: "owner@example.test", subject: "Reset", heading: "Reset", message: "", actionLabel: "Reset", actionUrl: "https://example.test" }, { ownerEmail: undefined, baseUrl: "http://localhost:3000", secret: undefined, resendApiKey: undefined, emailFrom: undefined })).rejects.toThrow(/RESEND_API_KEY/);
  });
});
