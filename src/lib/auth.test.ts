import { describe, expect, it } from "vitest";
import { credentialsAreValid, createDemoSessionToken, demoSessionFromCookieHeader, DEMO_SESSION_COOKIE, verifyDemoSessionToken } from "./auth";
import type { DemoAuthEnv } from "./env";

const config: DemoAuthEnv = {
  email: "demo@chaser.test",
  password: "chaser-demo-2026",
  sessionSecret: "test-session-secret-long-enough-for-signing-32-characters",
};

describe("single-owner demo authentication", () => {
  it("accepts the configured demo credentials and normalizes the email", () => {
    expect(credentialsAreValid(" DEMO@CHASER.TEST ", "chaser-demo-2026", config)).toBe(true);
    expect(credentialsAreValid("demo@chaser.test", "wrong-password", config)).toBe(false);
    expect(credentialsAreValid("other@chaser.test", "chaser-demo-2026", config)).toBe(false);
  });

  it("verifies signed sessions and rejects altered, expired, or foreign-owner sessions", () => {
    const token = createDemoSessionToken(config.email, config.sessionSecret!, 2_000);
    expect(verifyDemoSessionToken(token, config.sessionSecret!, config, 1_999)).toMatchObject({ email: config.email });
    expect(verifyDemoSessionToken(token, "a-different-secret-long-enough-to-sign-this-value", config, 1_999)).toBeNull();
    expect(verifyDemoSessionToken(token, config.sessionSecret!, config, 2_000)).toBeNull();
    const foreignToken = createDemoSessionToken("intruder@chaser.test", config.sessionSecret!, 2_000);
    expect(verifyDemoSessionToken(foreignToken, config.sessionSecret!, config, 1_999)).toBeNull();
  });

  it("rejects malformed and unsigned session tokens", () => {
    expect(verifyDemoSessionToken(undefined, config.sessionSecret!, config)).toBeNull();
    expect(verifyDemoSessionToken("not-a-session", config.sessionSecret!, config)).toBeNull();
  });

  it("reads a valid signed session from the request cookie header", () => {
    const token = createDemoSessionToken(config.email, config.sessionSecret!, Math.floor(Date.now() / 1000) + 600);
    expect(demoSessionFromCookieHeader(`theme=dark; ${DEMO_SESSION_COOKIE}=${token}`, config)).toMatchObject({ email: config.email });
    expect(demoSessionFromCookieHeader("theme=dark", config)).toBeNull();
  });
});
