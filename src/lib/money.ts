// Money is integer cents everywhere (AGENTS.md hard rule 1). No floats: all
// conversions below go through string arithmetic or integer division.
import type { Cents } from "./types";

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be integer cents, got ${cents}`);
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 123450 -> "$1,234.50" (always USD, always en-US style, independent of locale). */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  const body = `$${groupThousands(String(dollars))}.${String(rem).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/** 123450 -> "1234.50". The decimal-string form PayPal's API expects. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const body = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * "1234.50" -> 123450. Strict: at most two decimals, no thousands separators,
 * no exponent, no whitespace. Anything else throws rather than silently rounding.
 */
export function decimalStringToCents(value: string): Cents {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new SyntaxError(`Invalid decimal money string: "${value}"`);
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  assertCents(cents);
  return sign && cents !== 0 ? -cents : cents;
}
