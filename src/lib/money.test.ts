import { describe, expect, it } from "vitest";
import { centsToDecimalString, decimalStringToCents, formatCents } from "./money";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [99, "$0.99"],
    [100, "$1.00"],
    [123450, "$1,234.50"],
    [240000, "$2,400.00"],
    [100000000, "$1,000,000.00"],
    [-5, "-$0.05"],
    [-123450, "-$1,234.50"],
  ])("%i -> %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("rejects non-integer money", () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
    expect(() => formatCents(Infinity)).toThrow(RangeError);
  });
});

describe("centsToDecimalString", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [10, "0.10"],
    [123450, "1234.50"],
    [-250, "-2.50"],
  ])("%i -> %s", (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });

  it("rejects non-integer money", () => {
    expect(() => centsToDecimalString(0.1)).toThrow(RangeError);
  });
});

describe("decimalStringToCents", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["0.05", 5],
    ["1234.50", 123450],
    ["1234.5", 123450],
    ["1234", 123400],
    ["-2.50", -250],
    // Classic float traps: 0.1 + 0.2 and 1.005 must stay exact.
    ["0.10", 10],
    ["19.99", 1999],
    ["1.01", 101],
  ])("%s -> %i", (input, expected) => {
    expect(decimalStringToCents(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "1,234.50", " 1.00", "1.00 ", "1e3", ".5", "5.", "--1", "$1.00"])(
    "rejects %j",
    (input) => {
      expect(() => decimalStringToCents(input)).toThrow(SyntaxError);
    },
  );

  it("does not produce negative zero", () => {
    expect(Object.is(decimalStringToCents("-0.00"), 0)).toBe(true);
  });

  it("round-trips with centsToDecimalString", () => {
    for (const cents of [0, 1, 9, 10, 99, 100, 101, 123450, 999999999, -1, -250]) {
      expect(decimalStringToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});
