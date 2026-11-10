import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_KEYS,
  EnvError,
  getAppEnv,
  getAuthEnv,
  getDatabaseEnv,
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

describe("getDatabaseEnv", () => {
  const url = "libsql://chaser.example.turso.io";

  it("uses the local path unless both Turso settings are configured", () => {
    expect(getDatabaseEnv({ DATABASE_PATH: "./test/chaser.db", TURSO_AUTH_TOKEN: "" }))
      .toEqual({ mode: "local", path: "./test/chaser.db" });
    expect(getDatabaseEnv({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "test-token" }))
      .toEqual({ mode: "turso", url, authToken: "test-token" });
  });

  it("fails closed on incomplete credentials and non-Turso endpoints", () => {
    expect(() => getDatabaseEnv({ TURSO_DATABASE_URL: url })).toThrow(/TURSO_AUTH_TOKEN/);
    expect(() => getDatabaseEnv({ TURSO_AUTH_TOKEN: "test-token" })).toThrow(/TURSO_DATABASE_URL/);
    expect(() => getDatabaseEnv({
      TURSO_DATABASE_URL: "libsql://example.com",
      TURSO_AUTH_TOKEN: "test-token",
    })).toThrow(/TURSO_DATABASE_URL/);
  });
});

describe("getAppEnv", () => {
  it("applies defaults and treats blank values as unset", () => {
    expect(getAppEnv({ DEMO_NOW: "", DATABASE_PATH: "" })).toEqual({
      appBaseUrl: "http://localhost:3000",
      databasePath: "./data/chaser.db",
      demoNow: undefined,
      demoPublic: false,
    });
  });

  it("accepts a pinned DEMO_NOW and rejects garbage", () => {
    expect(getAppEnv({ DEMO_NOW: "2026-11-02" }).demoNow).toBe("2026-11-02");
    expect(() => getAppEnv({ DEMO_NOW: "next tuesday" })).toThrow(EnvError);
  });

  it("DEMO_PUBLIC=1 sets demoPublic to true; off by default", () => {
    expect(getAppEnv({ DEMO_PUBLIC: "1" }).demoPublic).toBe(true);
    expect(getAppEnv({ DEMO_PUBLIC: "0" }).demoPublic).toBe(false);
    expect(getAppEnv({}).demoPublic).toBe(false);
    expect(getAppEnv({ DEMO_PUBLIC: "" }).demoPublic).toBe(false);
  });

  it("DEMO_PUBLIC rejects values other than 0 and 1", () => {
    expect(() => getAppEnv({ DEMO_PUBLIC: "true" })).toThrow(EnvError);
    expect(() => getAppEnv({ DEMO_PUBLIC: "yes" })).toThrow(EnvError);
  });
});

describe("getAuthEnv", () => {
  it("leaves single-owner auth unconfigured until private server settings are provided", () => {
    expect(getAuthEnv({})).toEqual({ ownerEmail: undefined, baseUrl: "http://localhost:3000", secret: undefined, resendApiKey: undefined, resendFrom: undefined });
  });

  it("normalizes owner email and accepts a strong secret and verified sender settings", () => {
    expect(getAuthEnv({ APP_BASE_URL: "https://chaser.example.test", AUTH_OWNER_EMAIL: "OWNER@example.test", BETTER_AUTH_SECRET: "s".repeat(32), RESEND_API_KEY: "private", RESEND_FROM: "Chaser <no-reply@example.test>" })).toMatchObject({ ownerEmail: "owner@example.test", baseUrl: "https://chaser.example.test", secret: "s".repeat(32), resendFrom: "Chaser <no-reply@example.test>" });
  });

  it("names invalid settings without revealing configured values", () => {
    expect(() => getAuthEnv({ AUTH_OWNER_EMAIL: "not-an-email" })).toThrow(/AUTH_OWNER_EMAIL/);
    expect(() => getAuthEnv({ BETTER_AUTH_SECRET: "short-secret-value" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => getAuthEnv({ BETTER_AUTH_SECRET: "secret-value-that-is-long-enough-000000" })).not.toThrow();
    try { getAuthEnv({ BETTER_AUTH_SECRET: "short-secret-value" }); } catch (error) { expect(String(error)).not.toContain("short-secret-value"); }
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

  it("keeps the Anthropic provider and configured model as the default path", () => {
    expect(getLlmEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "existing-model" })).toMatchObject({ provider: "anthropic", mode: "live", model: "existing-model" });
  });

  it("selects OpenAI-compatible mode when configured or when it is the only key", () => {
    expect(getLlmEnv({ LLM_API_KEY: "k", LLM_BASE_URL: "https://example.test/v1", LLM_MODEL: "model" })).toMatchObject({ provider: "openai-compatible", mode: "live", model: "model" });
    expect(getLlmEnv({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k", LLM_BASE_URL: "https://example.test/v1", LLM_MODEL: "model" }).provider).toBe("openai-compatible");
    expect(getLlmEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a", LLM_API_KEY: "k" }).provider).toBe("anthropic");
  });

  it("uses scripted mode when no selected provider key exists and names missing config keys", () => {
    expect(getLlmEnv({ LLM_PROVIDER: "openai-compatible", ANTHROPIC_API_KEY: "a" }).mode).toBe("scripted");
    expect(() => getLlmEnv({ LLM_MODE: "live", LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "secret" })).toThrow(/LLM_BASE_URL/);
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
