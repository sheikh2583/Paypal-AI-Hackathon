// The one place that knows what "now" is. Everything else (policy, risk,
// seed, agent) must call getNow() instead of `new Date()` so the demo can be
// pinned (DEMO_NOW) and fast-forwarded ("advance time").
import { getAppEnv } from "./env";
import { db, type AppDb } from "./db/client";
import { getKv, setKv } from "./db/queries";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_OFFSET_KEY = "clock_offset_days";
let testDatabase: AppDb | undefined;

/** Allows the clock tests to use an isolated in-memory database. */
export function setClockDatabaseForTests(database: AppDb | undefined): void {
  testDatabase = database;
}

function activeDatabase(database?: AppDb): AppDb {
  return database ?? testDatabase ?? db;
}

export function getClockOffsetMs(database?: AppDb): number {
  const days = Number(getKv(CLOCK_OFFSET_KEY, activeDatabase(database)) ?? 0);
  return Number.isFinite(days) ? days * DAY_MS : 0;
}

export function setClockOffset(days: number, database?: AppDb): void {
  if (!Number.isFinite(days)) throw new Error("clock offset must be a finite number of days");
  setKv(CLOCK_OFFSET_KEY, String(days), activeDatabase(database));
}

export function advanceDays(days: number, database?: AppDb): void {
  if (!Number.isFinite(days)) throw new Error("days to advance must be finite");
  const targetDb = activeDatabase(database);
  const currentDays = Number(getKv(CLOCK_OFFSET_KEY, targetDb) ?? 0);
  setClockOffset(currentDays + days, targetDb);
}

/** Millisecond compatibility seam retained for existing callers. */
export function setClockOffsetMs(ms: number, database?: AppDb): void {
  if (!Number.isFinite(ms)) throw new Error("clock offset must be a finite number of ms");
  setClockOffset(ms / DAY_MS, activeDatabase(database));
}

export function advanceClockDays(days: number, database?: AppDb): void {
  advanceDays(days, activeDatabase(database));
}

/** DEMO_NOW if set, otherwise real time, plus the demo offset. */
export function getNow(database?: AppDb): Date {
  const { demoNow } = getAppEnv();
  const base = demoNow ? new Date(demoNow) : new Date();
  return new Date(base.getTime() + getClockOffsetMs(database));
}
