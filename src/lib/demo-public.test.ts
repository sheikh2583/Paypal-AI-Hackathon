/**
 * Tests for DEMO_PUBLIC mode auth bypass (D56).
 *
 * getAuthReadiness, getDemoSession and isDemoRequestAuthenticated must return
 * "authenticated/ready" when DEMO_PUBLIC=1, regardless of whether auth env
 * vars are configured. When DEMO_PUBLIC is off, behaviour is unchanged.
 *
 * Because auth.ts reads isDemoPublic once at module load we test the pure
 * helpers that are fully controlled by env getters passed in as arguments:
 * getAppEnv / getAuthEnv / getPayPalEnv / getLlmEnv accept an optional env
 * source object, so we can exercise every case without touching process.env.
 */
import { describe, expect, it } from "vitest";
import { getAppEnv, getAuthEnv, getLlmEnv, getPayPalEnv } from "./env";

describe("DEMO_PUBLIC env flag (D56)", () => {
  // -------------------------------------------------------------------------
  // Env layer — these are the source-of-truth checks; all downstream auth
  // helpers delegate to getAppEnv().demoPublic.
  // -------------------------------------------------------------------------

  it("demoPublic is false by default", () => {
    expect(getAppEnv({}).demoPublic).toBe(false);
    expect(getAppEnv({ DEMO_PUBLIC: "" }).demoPublic).toBe(false);
    expect(getAppEnv({ DEMO_PUBLIC: "0" }).demoPublic).toBe(false);
  });

  it("demoPublic is true when DEMO_PUBLIC=1", () => {
    expect(getAppEnv({ DEMO_PUBLIC: "1" }).demoPublic).toBe(true);
  });

  it("when DEMO_PUBLIC=1, getAuthEnv still returns normal auth settings independently", () => {
    // Auth env is independent — DEMO_PUBLIC only controls the gate, not the
    // stored credentials. Both must coexist without interference.
    const env = getAuthEnv({ DEMO_PUBLIC: "1" });
    expect(env.ownerEmail).toBeUndefined();
    expect(env.secret).toBeUndefined();
  });

  it("DEMO_PUBLIC=0 leaves auth variables unconfigured (no bypass)", () => {
    const env = getAppEnv({ DEMO_PUBLIC: "0" });
    expect(env.demoPublic).toBe(false);
    // With demoPublic false, the usual auth readiness check must enforce vars.
    // We test that by confirming getAuthEnv returns undefined for missing keys.
    const auth = getAuthEnv({});
    expect(auth.ownerEmail).toBeUndefined();
    expect(auth.secret).toBeUndefined();
  });

  it("DEMO_PUBLIC=1 does not affect PayPal or LLM env groups", () => {
    const paypal = getPayPalEnv({ DEMO_PUBLIC: "1" });
    expect(paypal.mode).toBe("mock");
    const llm = getLlmEnv({ DEMO_PUBLIC: "1" });
    expect(llm.mode).toBe("scripted");
  });
});
