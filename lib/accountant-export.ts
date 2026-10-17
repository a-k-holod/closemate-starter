import { EXPENSE_CATEGORIES, formatNip } from "./invoice";
import { CURRENCIES, minorToDecimalString, type Currency, type MinorUnits } from "./money";
import type { ReconciliationResult, ReconciliationStatus } from "./reconcile";

export const CSV_BOM = "\uFEFF";
export const CSV_DELIMITER = ";";
const CSV_LINE_BREAK = "\r\n";

export const ACCOUNTANT_CSV_HEADERS = [
  "Nr faktury",
  "Dostawca",
  "NIP dostawcy",
  "Data wystawienia",
  "Termin płatności",
  "Netto",
  "VAT",
  "Brutto",
  "Waluta",
  "Kategoria",
  "Status uzgodnienia",
  "ID transakcji",
  "Różnica",
  "Status weryfikacji",
  "Notatki"
] as const;

export const reconciliationStatusPl: Record<ReconciliationStatus, string> = {
  matched: "Uzgodniona",
  amount_mismatch: "Niezgodność kwoty",
  missing_payment: "Brak płatności",
  possible_duplicate: "Możliwy duplikat",
  needs_review: "Do ręcznej weryfikacji"
};

/** A reconciliation status, or a dashboard view that isn't a single status ("filtered" = search or reviewer queue). */
export type ExportScope = ReconciliationStatus | "overdue" | "filtered";

const scopeFileSlug: Record<ExportScope, string> = {
  matched: "uzgodnione",
  amount_mismatch: "niezgodnosc-kwoty",
  missing_payment: "brak-platnosci",
  possible_duplicate: "mozliwy-duplikat",
  needs_review: "do-weryfikacji",
  overdue: "po-terminie",
  filtered: "filtrowane"
};

export function verificationStatusPl(status: ReconciliationStatus): string {
  return status === "matched" ? "Potwierdzona" : "Do weryfikacji";
}

/** A trusted application amount in minor units; serialised exactly, never via floating point. */
export type CsvAmount = { amountMinor: MinorUnits; currency: Currency };

/** Amounts are trusted application values; strings are untrusted text from documents or users. */
export type CsvCell = string | CsvAmount | null | undefined;

const FORMULA_TRIGGER = /^\s*[=+\-@]|^[\t\r]/;
const PLAIN_SIGNED_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;
const NEEDS_QUOTING = /[";\r\n]|^\s|\s$/;

/** Polish decimal comma, no thousands separator, so Excel (pl-PL) parses it as a number. */
export function formatCsvAmount(amountMinor: MinorUnits, currency: Currency): string {
  if (!Number.isSafeInteger(amountMinor)) return "";
  return minorToDecimalString(amountMinor, currency, ",");
}

export function neutralizeFormula(value: string): string {
  if (!FORMULA_TRIGGER.test(value)) return value;
  if (PLAIN_SIGNED_NUMBER.test(value.trim())) return value;
  return `'${value}`;
}

export function escapeCsvField(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return formatCsvAmount(cell.amountMinor, cell.currency);
  return escapeCsvField(neutralizeFormula(cell));
}

export function serializeCsvRow(cells: readonly CsvCell[]): string {
  return cells.map(serializeCsvCell).join(CSV_DELIMITER);
}

function notesFor(result: ReconciliationResult): string {
  const notes = result.reviewReasons.map((r) => r.message);
  if (result.due.state === "overdue") notes.unshift(`Overdue by ${result.due.daysPastDue} day${result.due.daysPastDue === 1 ? "" : "s"}.`);
  return notes.join(" ");
}

/** Explicit allow-list of fields: never spread domain objects into the export. */
export function toAccountantRow(result: ReconciliationResult): CsvCell[] {
  const { invoice } = result;
  const amount = (amountMinor: MinorUnits): CsvAmount => ({ amountMinor, currency: invoice.currency });
  return [
    invoice.number,
    invoice.vendor,
    invoice.vendorNip ? formatNip(invoice.vendorNip) : null,
    invoice.issuedAt,
    invoice.dueAt,
    amount(invoice.netMinor),
    amount(invoice.vatMinor),
    amount(invoice.grossMinor),
    invoice.currency,
    EXPENSE_CATEGORIES[invoice.category]?.polish ?? invoice.category,
    reconciliationStatusPl[result.status],
    result.matchedPayments.map((payment) => payment.id).join(", "),
    amount(result.deltaMinor),
    verificationStatusPl(result.status),
    notesFor(result)
  ];
}

export function buildAccountantCsv(records: readonly ReconciliationResult[]): string {
  const lines = [serializeCsvRow(ACCOUNTANT_CSV_HEADERS), ...records.map((record) => serializeCsvRow(toAccountantRow(record)))];
  return CSV_BOM + lines.join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}

export type CurrencyTotal = { currency: Currency; count: number; grossMinor: MinorUnits };

/** Gross totals per currency in PLN, EUR, USD order. Never produces a cross-currency total. */
export function summarizeByCurrency(records: readonly ReconciliationResult[]): CurrencyTotal[] {
  const totals = new Map<Currency, CurrencyTotal>();
  for (const { invoice } of records) {
    const entry = totals.get(invoice.currency) ?? { currency: invoice.currency, count: 0, grossMinor: 0 };
    entry.count += 1;
    entry.grossMinor += invoice.grossMinor;
    totals.set(invoice.currency, entry);
  }
  return CURRENCIES.flatMap((currency) => totals.get(currency) ?? []);
}

export function formatExportDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function accountantExportFilename(date: Date, statusFilter: ExportScope | null): string {
  const scope = statusFilter ? scopeFileSlug[statusFilter] : "wszystkie";
  return `closemate_eksport-dla-ksiegowego_${formatExportDate(date)}_${scope}.csv`;
}

export type AccountantExport =
  | { ok: false; reason: "empty" }
  | { ok: true; filename: string; content: string; recordCount: number; totals: CurrencyTotal[] };

export function createAccountantExport(
  records: readonly ReconciliationResult[],
  options: { date: Date; statusFilter: ExportScope | null }
): AccountantExport {
  if (records.length === 0) return { ok: false, reason: "empty" };
  return {
    ok: true,
    filename: accountantExportFilename(options.date, options.statusFilter),
    content: buildAccountantCsv(records),
    recordCount: records.length,
    totals: summarizeByCurrency(records)
  };
}
