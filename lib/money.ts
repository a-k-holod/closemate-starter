export const CURRENCIES = ["PLN", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** ISO 4217 minor-unit exponent. All supported currencies use 2 decimal places. */
export const MINOR_UNIT_DIGITS: Record<Currency, number> = { PLN: 2, EUR: 2, USD: 2 };

/** All monetary values in the domain model are integers in minor units (grosze / cents). */
export type MinorUnits = number;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Converts a decimal amount to integer minor units, rounding half away from zero
 * (amounts of 0.5 grosz and more round up, matching Polish VAT invoice rounding).
 * Works on the decimal string so binary floating-point artefacts such as
 * 0.1 + 0.2 = 0.30000000000000004 or 1.005 = 1.00499999… do not change the result.
 * Accepts "." or "," as decimal separator and spaces as thousands separators.
 */
export function toMinorUnits(amount: number | string, currency: Currency): MinorUnits {
  const digits = MINOR_UNIT_DIGITS[currency];
  let text: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new RangeError(`Amount must be finite, got ${amount}.`);
    text = String(amount);
    if (/e/i.test(text)) text = amount.toFixed(Math.min(100, digits + 10));
  } else {
    text = amount.replace(/[\s\u00a0\u202f]/g, "");
    if (text.includes(",") && text.includes(".")) throw new RangeError(`Ambiguous decimal separators in "${amount}".`);
    text = text.replace(",", ".");
  }
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new RangeError(`"${amount}" is not a valid decimal amount.`);
  const [, sign, whole, fraction = ""] = match;
  const kept = fraction.slice(0, digits).padEnd(digits, "0");
  const roundUp = fraction.length > digits && Number(fraction[digits]) >= 5;
  const magnitude = Number(whole) * 10 ** digits + Number(kept) + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(magnitude)) throw new RangeError(`"${amount}" exceeds the supported range.`);
  return sign === "-" && magnitude !== 0 ? -magnitude : magnitude;
}

/** Integer division rounding half away from zero, so it never goes through floating point. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("divideRoundHalfUp expects safe integers and a positive denominator.");
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const quotient = Math.floor(abs / denominator);
  const remainder = abs - quotient * denominator;
  const result = sign * (remainder * 2 >= denominator ? quotient + 1 : quotient);
  return result === 0 ? 0 : result;
}

/** VAT for a net amount at a whole-percent rate, rounded to the minor unit. */
export function percentOf(netMinor: MinorUnits, ratePercent: number): MinorUnits {
  return divideRoundHalfUp(netMinor * ratePercent, 100);
}

/** Exact decimal string for minor units, e.g. 30749 → "307.49", -5 → "-0.05". */
export function minorToDecimalString(amountMinor: MinorUnits, currency: Currency, decimalSeparator = "."): string {
  const digits = MINOR_UNIT_DIGITS[currency];
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 10 ** digits);
  const fraction = String(abs % 10 ** digits).padStart(digits, "0");
  return `${amountMinor < 0 ? "-" : ""}${whole}${digits ? decimalSeparator + fraction : ""}`;
}

const formatters = new Map<Currency, Intl.NumberFormat>();

/** Formats minor units with an explicit ISO code, e.g. "PLN 1,476.00", "EUR 49.00". */
export function formatMoney(amountMinor: MinorUnits, currency: Currency): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    const digits = MINOR_UNIT_DIGITS[currency];
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(amountMinor / 10 ** MINOR_UNIT_DIGITS[currency]).replace(/[\u00a0\u202f]/g, " ");
}

export type CurrencyTotals = Partial<Record<Currency, MinorUnits>>;

/** Sums amounts per currency. Different currencies are never added together. */
export function totalsByCurrency<T>(items: readonly T[], pick: (item: T) => { amountMinor: MinorUnits; currency: Currency }): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const item of items) {
    const { amountMinor, currency } = pick(item);
    totals[currency] = (totals[currency] ?? 0) + amountMinor;
  }
  return totals;
}

/** Sums amounts that must all share one currency; throws instead of mixing currencies. */
export function sumSameCurrency(items: readonly { amountMinor: MinorUnits; currency: Currency }[], currency: Currency): MinorUnits {
  return items.reduce((sum, item) => {
    if (item.currency !== currency) throw new Error(`Cannot add ${item.currency} to a ${currency} total.`);
    return sum + item.amountMinor;
  }, 0);
}

/** Renders per-currency totals in a fixed PLN, EUR, USD order, e.g. "PLN 1,157.49 · EUR 49.00". */
export function formatCurrencyTotals(totals: CurrencyTotals, emptyText = "—"): string {
  const parts = CURRENCIES.filter((c) => totals[c] !== undefined).map((c) => formatMoney(totals[c]!, c));
  return parts.length ? parts.join(" · ") : emptyText;
}
