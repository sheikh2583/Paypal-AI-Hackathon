// Key pool for the OpenAI-compatible adapter (D75). Keys are only ever referred to by
// their 1-based position ("key #N"); this module never logs or returns a key.

export interface PoolCombo {
  /** 0-based index into the key list. Display as `key #${keyIndex + 1}`. */
  keyIndex: number;
  model: string;
}

export const PER_MINUTE_COOLDOWN_MS = 60_000;
export const TRANSIENT_COOLDOWN_MS = 30_000;

const comboId = ({ keyIndex, model }: PoolCombo) => `${keyIndex}|${model}`;

/**
 * Tracks which key + model combinations are usable. One instance lives for the whole server
 * process, so a cooldown learned in one request protects the next.
 */
export class KeyPool {
  private cursor = 0;
  private readonly cooldownUntil = new Map<string, number>();
  private readonly disabledKeys = new Set<number>();
  private readonly excluded = new Set<string>();
  private readonly warned = new Set<string>();

  constructor(
    readonly keyCount: number,
    readonly models: readonly string[],
    private readonly now: () => number = Date.now,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  /** Keys in round-robin order starting after the last key that was handed out. */
  nextKeyOrder(): number[] {
    const order: number[] = [];
    for (let step = 0; step < this.keyCount; step++) order.push((this.cursor + step) % this.keyCount);
    this.cursor = (this.cursor + 1) % Math.max(1, this.keyCount);
    return order.filter((keyIndex) => !this.disabledKeys.has(keyIndex));
  }

  isUsable(combo: PoolCombo): boolean {
    if (this.disabledKeys.has(combo.keyIndex) || this.excluded.has(comboId(combo))) return false;
    return (this.cooldownUntil.get(comboId(combo)) ?? 0) <= this.now();
  }

  /** When the combination becomes usable again, or 0 if it already is. */
  readyAt(combo: PoolCombo): number {
    return Math.max(0, (this.cooldownUntil.get(comboId(combo)) ?? 0));
  }

  coolDown(combo: PoolCombo, untilMs: number): void {
    this.cooldownUntil.set(comboId(combo), Math.max(untilMs, this.cooldownUntil.get(comboId(combo)) ?? 0));
  }

  /** Server errors, timeouts and network failures pause every model on the key. */
  coolDownKey(keyIndex: number, durationMs = TRANSIENT_COOLDOWN_MS): void {
    for (const model of this.models) this.coolDown({ keyIndex, model }, this.now() + durationMs);
  }

  /** A rejected key (401/403, "API key not valid") is unusable for the rest of the process. */
  disableKey(keyIndex: number, status: number): void {
    if (this.disabledKeys.has(keyIndex)) return;
    this.disabledKeys.add(keyIndex);
    this.warnOnce(`key-${keyIndex}`, `LLM key #${keyIndex + 1} was rejected by the provider (HTTP ${status}); it is disabled until the server restarts.`);
  }

  /** A model that cannot produce the required format on this key is left out for the process lifetime. */
  exclude(combo: PoolCombo, reason: string): void {
    if (this.excluded.has(comboId(combo))) return;
    this.excluded.add(comboId(combo));
    this.warnOnce(`exclude-${comboId(combo)}`, `LLM key #${combo.keyIndex + 1} with model ${combo.model} was left out of the pool: ${reason}.`);
  }

  isDisabled(keyIndex: number): boolean { return this.disabledKeys.has(keyIndex); }

  private warnOnce(id: string, message: string): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    this.warn(message);
  }
}

/** Milliseconds since the epoch of the next midnight in America/Los_Angeles, when Gemini daily quotas reset. */
export function nextPacificMidnight(nowMs: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(nowMs)).map(({ type, value }) => [type, Number(value)]));
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = wallClockAsUtc - Math.floor(nowMs / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset;
}

export interface RateLimitInfo {
  perDay: boolean;
  /** Provider-suggested wait, if any. */
  retryAfterMs: number | null;
}

/** Reads Gemini's RESOURCE_EXHAUSTED body (QuotaFailure / RetryInfo) and standard rate-limit headers. */
export function parseRateLimit(body: string, headers: Headers): RateLimitInfo {
  const perDay = /PerDay|per[ -]day|daily/i.test(body);
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1]
    ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(body)?.[1];
  const header = Number(headers.get("retry-after"));
  const retryAfterMs = delay ? Number(delay) * 1000 : Number.isFinite(header) && header > 0 ? header * 1000 : null;
  return { perDay, retryAfterMs };
}

/** Removes every pool key, plus anything shaped like a Google API key or a `key=` URL parameter. */
export function scrubSecrets(text: string, keys: readonly string[]): string {
  let scrubbed = text;
  for (const [index, key] of keys.entries()) if (key) scrubbed = scrubbed.split(key).join(`[key #${index + 1}]`);
  return scrubbed.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]").replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
}
