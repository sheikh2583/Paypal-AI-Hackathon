import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { isLostStream, ReconnectingConnection, type SyncConnection } from "./reconnecting";

// The error text the native libSQL driver raised on Render when Turso dropped the stream.
const lostStream = () => new Error('Hrana(Api("status=404 Not Found, body={\\"error\\":\\"stream not found: bdbb86ab:26fdcc5\\"}"))');

let dir: string;
let openConnection: ReconnectingConnection | undefined;
afterEach(() => {
  openConnection?.close();
  openConnection = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Real SQLite connections to one file; `breakNext` makes the current connection's stream "lost". */
function harness() {
  dir = mkdtempSync(path.join(tmpdir(), "chaser-reconnect-"));
  const file = path.join(dir, "db.sqlite");
  const state = { opened: 0, broken: false };
  const open = (): SyncConnection => {
    state.opened += 1;
    state.broken = false;
    const real = new BetterSqlite3(file);
    const guard = <T>(run: () => T): T => { if (state.broken) throw lostStream(); return run(); };
    return {
      prepare: (sql) => guard(() => {
        const statement = real.prepare(sql);
        const wrapped = {
          get reader() { return statement.reader; },
          raw: (toggle?: boolean) => { statement.raw(toggle); return wrapped; },
          pluck: (toggle?: boolean) => { statement.pluck(toggle); return wrapped; },
          run: (...params: unknown[]) => guard(() => statement.run(...params)),
          get: (...params: unknown[]) => guard(() => statement.get(...params)),
          all: (...params: unknown[]) => guard(() => statement.all(...params)),
          iterate: (...params: unknown[]) => guard(() => statement.iterate(...params)),
          columns: () => statement.columns(),
        };
        return wrapped;
      }),
      exec: (sql) => guard(() => real.exec(sql)),
      pragma: (source) => guard(() => real.pragma(source)),
      close: () => real.close(),
    };
  };
  const reconnects: unknown[] = [];
  const connection = new ReconnectingConnection(open, (error) => reconnects.push(error));
  openConnection = connection;
  connection.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
  return { connection, state, reconnects, breakNext: () => { state.broken = true; } };
}

describe("a Turso connection whose stream was dropped", () => {
  it("recognises the driver's lost-stream errors and nothing else", () => {
    expect(isLostStream(lostStream())).toBe(true);
    expect(isLostStream(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed"))).toBe(false);
  });

  it("opens a new connection and retries the statement once, so the request still succeeds", () => {
    const { connection, state, reconnects, breakNext } = harness();
    const insert = connection.prepare("INSERT INTO items (name) VALUES (?)");
    breakNext();
    insert.run("first");
    breakNext();
    expect(connection.prepare("SELECT name FROM items").raw().all()).toEqual([["first"]]);
    expect(state.opened).toBe(3);
    expect(reconnects).toHaveLength(2);
  });

  it("does not replay half a transaction: it reconnects, rolls nothing back twice and throws", () => {
    const { connection, breakNext } = harness();
    const write = connection.transaction((name: string) => {
      connection.prepare("INSERT INTO items (name) VALUES (?)").run(name);
      breakNext();
      connection.prepare("INSERT INTO items (name) VALUES (?)").run(`${name}-2`);
    });
    expect(() => write("plan")).toThrow(/stream not found/);
    // The next request works on the new connection.
    expect(connection.prepare("SELECT count(*) AS n FROM items").get()).toEqual({ n: 0 });
  });

  it("passes other errors straight through without reconnecting", () => {
    const { connection, reconnects } = harness();
    expect(() => connection.prepare("SELECT * FROM missing_table").all()).toThrow(/no such table/);
    expect(reconnects).toHaveLength(0);
  });
});
