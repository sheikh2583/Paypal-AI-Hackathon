import { Children, isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const test = vi.hoisted(() => ({ reconcile: vi.fn(async () => {}), retryWebhooks: vi.fn(async () => {}) }));

vi.mock("./reconcile", () => ({ reconcilePayPalInvoices: test.reconcile }));
vi.mock("./webhook", () => ({ retryPendingPayPalWebhooks: test.retryWebhooks }));
vi.mock("react/jsx-dev-runtime", async () => ({ jsxDEV: (await import("react/jsx-runtime")).jsx }));
vi.mock("@/lib/auth", () => ({ getDemoSession: async () => ({}), isDemoRequestAuthenticated: async () => true }));
vi.mock("@/lib/clock", () => ({ getNow: () => new Date() }));
vi.mock("@/lib/invoice-list", () => ({ listInvoiceItems: () => [] }));
vi.mock("@/lib/db/queries", () => ({ listApprovals: () => [] }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("chaserPayPalPoll", undefined);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEMO_PUBLIC", "1");
  vi.stubEnv("PAYPAL_MODE", "sandbox");
  vi.stubEnv("PAYPAL_CLIENT_ID", "fixture-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "fixture-secret");
  vi.stubEnv("PAYPAL_SANDBOX_MERCHANT_EMAIL", "merchant@example.com");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PayPal reconciliation on workspace reads", () => {
  it("reconciles from the invoice API and dashboard and starts one 10 second timer in public production", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    const { default: dashboard } = await import("@/app/(app)/page");
    const { DemoControls } = await import("@/components/demo-controls");

    expect((await GET()).status).toBe(200);
    expect(test.reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    const page = await dashboard();
    expect(test.reconcile).toHaveBeenCalledTimes(2);
    expect(Children.toArray(page.props.children).some((child) =>
      isValidElement<{ showReset: boolean }>(child) && child.type === DemoControls && child.props.showReset,
    )).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.reconcile).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(test.reconcile).toHaveBeenCalledTimes(4);
  });

  it("reconciles private production reads without starting a timer", async () => {
    vi.stubEnv("DEMO_PUBLIC", "0");
    const { reconcilePayPalOnRead } = await import("./poll");
    await reconcilePayPalOnRead();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(test.reconcile).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
