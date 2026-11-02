import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_KEYS,
  EnvError,
  getAppEnv,
  getLlmEnv,
  getPayPalEnv,
  SANDBOX_BASE_URL,
} from "./env";

describe("env schema coverage", () => {
  it("reads every variable listed in .env.example (and nothing undocumented)", () => {
    const text = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    const documented = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect([...ENV_KEYS].sort()).toEqual([...documented].sort());
  });
});

describe("getAppEnv", () => {
  it("applies defaults and treats blank values as unset", () => {
    expect(getAppEnv({ DEMO_NOW: "", DATABASE_PATH: "" })).toEqual({
      appBaseUrl: "http://localhost:3000",
      databasePath: "./data/chaser.db",
      demoNow: undefined,
    });
  });

  it("accepts a pinned DEMO_NOW and rejects garbage", () => {
    expect(getAppEnv({ DEMO_NOW: "2026-11-02" }).demoNow).toBe("2026-11-02");
    expect(() => getAppEnv({ DEMO_NOW: "next tuesday" })).toThrow(EnvError);
  });
});

describe("getLlmEnv", () => {
  it("defaults to auto → scripted when no API key", () => {
    const env = getLlmEnv({ ANTHROPIC_API_KEY: "" });
    expect(env).toMatchObject({
      configuredMode: "auto",
      mode: "scripted",
      model: "claude-sonnet-5-5",
    });
  });

  it("auto → live when a key is present", () => {
    expect(getLlmEnv({ ANTHROPIC_API_KEY: "k" }).mode).toBe("live");
  });

  it("explicit modes override auto", () => {
    expect(getLlmEnv({ ANTHROPIC_API_KEY: "k", LLM_MODE: "scripted" }).mode).toBe("scripted");
    expect(getLlmEnv({ LLM_MODE: "scripted" }).mode).toBe("scripted");
  });

  it("live without a key is an error that does not echo values", () => {
    expect(() => getLlmEnv({ LLM_MODE: "live" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("rejects an unknown mode", () => {
    expect(() => getLlmEnv({ LLM_MODE: "yolo" })).toThrow(EnvError);
  });
});

describe("getPayPalEnv", () => {
  it("defaults to mock mode on the sandbox URL with no keys needed", () => {
    expect(getPayPalEnv({})).toMatchObject({
      mode: "mock",
      baseUrl: SANDBOX_BASE_URL,
      clientId: undefined,
    });
  });

  it("sandbox mode requires client id and secret", () => {
    expect(() => getPayPalEnv({ PAYPAL_MODE: "sandbox" })).toThrow(/PAYPAL_CLIENT_ID/);
    expect(
      getPayPalEnv({
        PAYPAL_MODE: "sandbox",
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
      }).mode,
    ).toBe("sandbox");
  });

  it("refuses a live PayPal base URL (hard rule 3)", () => {
    expect(() => getPayPalEnv({ PAYPAL_BASE_URL: "https://api-m.paypal.com" })).toThrow(EnvError);
  });

  it("never includes secret values in error messages", () => {
    try {
      getPayPalEnv({ PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "super-secret-id" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("super-secret-id");
    }
  });
});

describe("lazy validation", () => {
  it("an invalid PayPal config does not break the app or LLM getters", () => {
    const bad = { PAYPAL_MODE: "sandbox" };
    expect(() => getAppEnv(bad)).not.toThrow();
    expect(() => getLlmEnv(bad)).not.toThrow();
  });
});
