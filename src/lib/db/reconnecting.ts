// Turso can drop the server-side stream behind a remote libSQL connection (for example after it restarts
// or after a long idle spell). The native driver then keeps sending the dead stream ID and every query
// fails with "stream not found" until the process restarts (D82). This wrapper opens a fresh connection
// when that happens and retries the statement once: the server ran nothing on a dead stream, so the
// retry cannot apply a write twice. Inside a transaction it reconnects but does not retry, because the
// earlier statements of that transaction are gone with the old stream.

/** The slice of the better-sqlite3 API that Drizzle, Better Auth (Kysely) and our code call. */
export interface SyncStatement {
  readonly reader: boolean;
  raw(toggle?: boolean): SyncStatement;
  pluck(toggle?: boolean): SyncStatement;
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
  columns(): unknown[];
}

export interface SyncConnection {
  prepare(sql: string): SyncStatement;
  exec(sql: string): unknown;
  pragma(source: string, options?: unknown): unknown;
  close(): unknown;
}

const LOST_STREAM = /stream not found|stream expired|STREAM_EXPIRED|invalid baton/i;

export function isLostStream(error: unknown): boolean {
  return LOST_STREAM.test(error instanceof Error ? `${error.message} ${String((error as { code?: unknown }).code ?? '')}` : String(error));
}

export class ReconnectingConnection implements SyncConnection {
  private current: SyncConnection;
  private generation = 0;
  private transactionDepth = 0;

  constructor(private readonly open: () => SyncConnection, private readonly onReconnect: (error: unknown) => void = () => undefined) {
    this.current = open();
  }

  /** Runs `attempt`; after a lost stream, reconnects, lets the caller rebuild state, and tries once more. */
  retry<T>(attempt: (connection: SyncConnection) => T, rebuild?: (connection: SyncConnection) => void): T {
    const generation = this.generation;
    try {
      return attempt(this.current);
    } catch (error) {
      if (!isLostStream(error)) throw error;
      // Another call may already have replaced the connection; only reconnect once per lost stream.
      if (generation === this.generation) this.reconnect(error);
      if (this.transactionDepth > 0) throw error;
      rebuild?.(this.current);
      return attempt(this.current);
    }
  }

  private reconnect(error: unknown): void {
    const stale = this.current;
    this.current = this.open();
    this.generation += 1;
    try { stale.close(); } catch { /* the old stream is already gone */ }
    this.onReconnect(error);
  }

  prepare(sql: string): SyncStatement {
    return new ReconnectingStatement(this, sql);
  }

  exec(sql: string): unknown {
    return this.retry((connection) => connection.exec(sql));
  }

  pragma(source: string, options?: unknown): unknown {
    return this.retry((connection) => connection.pragma(source, options));
  }

  close(): unknown {
    return this.current.close();
  }

  /** Same shape as better-sqlite3's transaction(): BEGIN, run, COMMIT, or ROLLBACK on error. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const wrap = (mode: string) => (...args: A): R => {
      this.exec(`BEGIN ${mode}`.trim());
      this.transactionDepth += 1;
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        // After a lost stream the new connection has no open transaction to roll back.
        try { this.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    };
    return Object.assign(wrap(''), { deferred: wrap('DEFERRED'), immediate: wrap('IMMEDIATE'), exclusive: wrap('EXCLUSIVE') });
  }
}

class ReconnectingStatement implements SyncStatement {
  private statement: SyncStatement;
  private rawMode: boolean | undefined;
  private pluckMode: boolean | undefined;

  constructor(private readonly owner: ReconnectingConnection, private readonly sql: string) {
    this.statement = owner.retry((connection) => connection.prepare(sql));
  }

  private rebuild = (connection: SyncConnection) => {
    let statement = connection.prepare(this.sql);
    if (this.rawMode !== undefined) statement = statement.raw(this.rawMode);
    if (this.pluckMode !== undefined) statement = statement.pluck(this.pluckMode);
    this.statement = statement;
  };

  private call<T>(run: (statement: SyncStatement) => T): T {
    return this.owner.retry(() => run(this.statement), this.rebuild);
  }

  get reader(): boolean { return this.statement.reader; }
  raw(toggle?: boolean): SyncStatement { this.rawMode = toggle ?? true; this.statement = this.statement.raw(this.rawMode); return this; }
  pluck(toggle?: boolean): SyncStatement { this.pluckMode = toggle ?? true; this.statement = this.statement.pluck(this.pluckMode); return this; }
  run(...params: unknown[]): unknown { return this.call((statement) => statement.run(...params)); }
  get(...params: unknown[]): unknown { return this.call((statement) => statement.get(...params)); }
  all(...params: unknown[]): unknown[] { return this.call((statement) => statement.all(...params)); }
  iterate(...params: unknown[]): IterableIterator<unknown> { return this.call((statement) => statement.iterate(...params)); }
  columns(): unknown[] { return this.call((statement) => statement.columns()); }
}
