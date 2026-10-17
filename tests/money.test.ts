import { describe, expect, it } from "vitest";
import { divideRoundHalfUp, formatCurrencyTotals, formatMoney, isCurrency, percentOf, sumSameCurrency, toMinorUnits, totalsByCurrency } from "../lib/money";

describe("toMinorUnits", () => {
  it("converts whole and fractional amounts exactly", () => {
    expect(toMinorUnits(1476, "PLN")).toBe(147600);
    expect(toMinorUnits("307.49", "PLN")).toBe(30749);
    expect(toMinorUnits("0.01", "EUR")).toBe(1);
    expect(toMinorUnits("49", "EUR")).toBe(4900);
    expect(toMinorUnits("20.5", "USD")).toBe(2050);
  });

  it("is immune to binary floating-point artefacts", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toMinorUnits(0.1 + 0.2, "PLN")).toBe(30);
    expect(toMinorUnits(1.1 + 2.2, "PLN")).toBe(330);
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(toMinorUnits(1.005, "PLN")).toBe(101);
    expect(toMinorUnits(8.675, "EUR")).toBe(868);
    expect(toMinorUnits(19.99 * 3, "USD")).toBe(5997);
  });

  it("rounds half away from zero at the third decimal", () => {
    expect(toMinorUnits("57.4977", "PLN")).toBe(5750);
    expect(toMinorUnits("0.004", "PLN")).toBe(0);
    expect(toMinorUnits("0.005", "PLN")).toBe(1);
    expect(toMinorUnits("2.675", "PLN")).toBe(268);
    expect(toMinorUnits("-2.675", "PLN")).toBe(-268);
    expect(toMinorUnits("-0.004", "PLN")).toBe(0);
    expect(Object.is(toMinorUnits("-0.004", "PLN"), -0)).toBe(false);
  });

  it("accepts Polish formatting and rejects ambiguous or invalid input", () => {
    expect(toMinorUnits("1 476,00", "PLN")).toBe(147600);
    expect(toMinorUnits("1\u00a0232,5", "PLN")).toBe(123250);
    expect(() => toMinorUnits("1,232.50", "PLN")).toThrow(RangeError);
    expect(() => toMinorUnits("12a", "PLN")).toThrow(RangeError);
    expect(() => toMinorUnits(Number.NaN, "PLN")).toThrow(RangeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY, "PLN")).toThrow(RangeError);
    expect(() => toMinorUnits("99999999999999999", "PLN")).toThrow(RangeError);
  });

  it("handles numbers that stringify in exponent form", () => {
    expect(toMinorUnits(1e-7, "PLN")).toBe(0);
    expect(toMinorUnits(5e-3, "PLN")).toBe(1);
  });
});

describe("integer rounding helpers", () => {
  it("divides with half-up rounding without floats", () => {
    expect(divideRoundHalfUp(574977, 100)).toBe(5750);
    expect(divideRoundHalfUp(150, 100)).toBe(2);
    expect(divideRoundHalfUp(149, 100)).toBe(1);
    expect(divideRoundHalfUp(-150, 100)).toBe(-2);
    expect(() => divideRoundHalfUp(1.5, 100)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(1, 0)).toThrow(RangeError);
  });

  it("computes VAT at Polish rates to the grosz", () => {
    expect(percentOf(24999, 23)).toBe(5750);
    expect(percentOf(9999, 23)).toBe(2300);
    expect(percentOf(100000, 8)).toBe(8000);
    expect(percentOf(1, 23)).toBe(0);
    expect(percentOf(3, 23)).toBe(1);
    expect(percentOf(12345, 5)).toBe(617);
  });
});

describe("currency formatting", () => {
  it("formats each currency with its ISO code and two decimals", () => {
    expect(formatMoney(147600, "PLN")).toBe("PLN 1,476.00");
    expect(formatMoney(4900, "EUR")).toBe("EUR 49.00");
    expect(formatMoney(2000, "USD")).toBe("USD 20.00");
    expect(formatMoney(30749, "PLN")).toBe("PLN 307.49");
    expect(formatMoney(1, "PLN")).toBe("PLN 0.01");
    expect(formatMoney(-36000, "USD")).toBe("-USD 360.00");
  });

  it("recognises only supported currencies", () => {
    expect(isCurrency("PLN")).toBe(true);
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("GBP")).toBe(false);
    expect(isCurrency(undefined)).toBe(false);
  });
});

describe("totals never mix currencies", () => {
  const items = [
    { amountMinor: 30749, currency: "PLN" as const },
    { amountMinor: 4900, currency: "EUR" as const },
    { amountMinor: 85000, currency: "PLN" as const }
  ];

  it("groups totals by currency", () => {
    expect(totalsByCurrency(items, (i) => i)).toEqual({ PLN: 115749, EUR: 4900 });
    expect(formatCurrencyTotals(totalsByCurrency(items, (i) => i))).toBe("PLN 1,157.49 · EUR 49.00");
    expect(formatCurrencyTotals({})).toBe("—");
  });

  it("refuses to add different currencies into one sum", () => {
    expect(sumSameCurrency(items.filter((i) => i.currency === "PLN"), "PLN")).toBe(115749);
    expect(() => sumSameCurrency(items, "PLN")).toThrow(/Cannot add EUR/);
  });

  it("sums many fractional amounts exactly in minor units", () => {
    const tenCents = Array.from({ length: 10 }, () => ({ amountMinor: toMinorUnits(0.1, "PLN"), currency: "PLN" as const }));
    expect(sumSameCurrency(tenCents, "PLN")).toBe(100);
    expect(Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0)).not.toBe(1);
  });
});
