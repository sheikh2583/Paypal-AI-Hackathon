import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getAppEnv } from "../env";
import { schema } from "./schema";

export type AppDb = BetterSQLite3Database<typeof schema> & {
  $client: InstanceType<typeof BetterSqlite3>;
};

export function openDb(databasePath: string): AppDb {
  const resolvedPath = databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
  if (resolvedPath !== ":memory:") {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new BetterSqlite3(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

let singleton: AppDb | undefined;
function getSingleton(): AppDb {
  singleton ??= openDb(getAppEnv().databasePath);
  return singleton;
}

// Keep imports side-effect free so unit tests can inject an in-memory DB.
export const db = new Proxy({} as AppDb, {
  get(_target, property) {
    const database = getSingleton();
    const value = Reflect.get(database, property, database) as unknown;
    return typeof value === "function" ? value.bind(database) : value;
  },
});
