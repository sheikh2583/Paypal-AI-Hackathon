import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceDays, getNow, setClockDatabaseForTests, setClockOffset } from "./clock";
import { closeTestDb, createTestDb } from "./db/test-utils";
import type { AppDb } from "./db/client";

let testDb: AppDb;

describe("getNow", () => {
  beforeEach(() => {
    testDb = createTestDb();
    setClockDatabaseForTests(testDb);
    setClockOffset(0);
  });
  afterEach(() => {
    setClockDatabaseForTests(undefined);
    closeTestDb(testDb);
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("uses DEMO_NOW when set", () => {
    vi.stubEnv("DEMO_NOW", "2026-11-02T00:00:00Z");
    expect(getNow().toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("falls back to real time when DEMO_NOW is blank", () => {
    vi.stubEnv("DEMO_NOW", "");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(getNow().toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("applies the demo offset on top of a pinned date", () => {
    vi.stubEnv("DEMO_NOW", "2026-11-02T00:00:00Z");
    advanceDays(10);
    expect(getNow().toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("rejects a non-finite offset", () => {
    expect(() => setClockOffset(Number.NaN)).toThrow();
  });

  it("persists the offset in the test database", () => {
    vi.stubEnv("DEMO_NOW", "2026-11-02T00:00:00Z");
    setClockOffset(2.5);
    advanceDays(1);
    expect(getNow().toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });
});
