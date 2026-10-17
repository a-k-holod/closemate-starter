import { EXPENSE_CATEGORIES, formatNip } from "./invoice";
import { requiresReview } from "./invoice-review";
import { CURRENCIES, minorToDecimalString, type Currency, type MinorUnits } from "./money";
import type { ReconciliationResult, ReconciliationStatus } from "./reconcile";
import { getReviewEntry, type ReviewDecision, type ReviewStore } from "./review-state";

export const CSV_BOM = "\uFEFF";
export const CSV_DELIMITER = ";";
const CSV_LINE_BREAK = "\r\n";

/**
 * Every column is produced by deterministic CloseMate rules from the invoice and bank records.
 * None of them records a human approval.
 */
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
  "Status uzgodnienia (automatyczny)",
  "ID transakcji",
  "Różnica (płatności - brutto)",
  "Wymaga przeglądu (reguły)",
  "Uwagi systemowe"
] as const;

/** Appended only when the user explicitly opts in; values come from this browser's local review store. */
export const REVIEWER_CSV_HEADERS = ["Decyzja recenzenta (zapis lokalny)", "Notatka recenzenta (zapis lokalny)"] as const;

export type AccountantCsvHeader = (typeof ACCOUNTANT_CSV_HEADERS)[number] | (typeof REVIEWER_CSV_HEADERS)[number];

export const reviewerDecisionPl: Record<ReviewDecision | "none", string> = {
  reviewed: "Oznaczona jako sprawdzona",
  needs_review: "Oznaczona do weryfikacji",
  none: "Brak decyzji"
};

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

/** Whether CloseMate's rules put the record in the review queue. Not a reviewer decision. */
export function requiresReviewPl(result: ReconciliationResult): string {
  return requiresReview(result) ? "Tak" : "Nie";
}

/** A trusted application amount in minor units; serialised exactly, never via floating point. */
export type CsvAmount = { amountMinor: MinorUnits; currency: Currency };

/** Amounts are trusted application values; strings are untrusted text from documents or users. */
export type CsvCell = string | CsvAmount | null | undefined;

const FORMULA_TRIGGER = /^\s*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r\n]/;
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

export type AccountantCsvOptions = {
  /** Local reviewer decisions and notes. Omit to keep them out of the file (the default). */
  review?: ReviewStore;
};

export function accountantCsvHeaders(options: AccountantCsvOptions = {}): readonly AccountantCsvHeader[] {
  return options.review ? [...ACCOUNTANT_CSV_HEADERS, ...REVIEWER_CSV_HEADERS] : ACCOUNTANT_CSV_HEADERS;
}

/** Explicit allow-list of fields: never spread domain objects into the export. */
export function toAccountantRow(result: ReconciliationResult, options: AccountantCsvOptions = {}): CsvCell[] {
  const { invoice } = result;
  const amount = (amountMinor: MinorUnits): CsvAmount => ({ amountMinor, currency: invoice.currency });
  const reviewerCells: CsvCell[] = [];
  if (options.review) {
    const entry = getReviewEntry(options.review, invoice.id);
    reviewerCells.push(reviewerDecisionPl[entry.decision ?? "none"], entry.note || null);
  }
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
    requiresReviewPl(result),
    notesFor(result),
    ...reviewerCells
  ];
}

export function buildAccountantCsv(records: readonly ReconciliationResult[], options: AccountantCsvOptions = {}): string {
  const lines = [serializeCsvRow(accountantCsvHeaders(options)), ...records.map((record) => serializeCsvRow(toAccountantRow(record, options)))];
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

export function accountantExportFilename(date: Date, statusFilter: ExportScope | null, includesReviewerNotes = false): string {
  const scope = statusFilter ? scopeFileSlug[statusFilter] : "wszystkie";
  return `closemate_eksport-dla-ksiegowego_${formatExportDate(date)}_${scope}${includesReviewerNotes ? "_z-notatkami-recenzenta" : ""}.csv`;
}

export type AccountantExport =
  | { ok: false; reason: "empty" }
  | { ok: true; filename: string; content: string; recordCount: number; totals: CurrencyTotal[]; includesReviewerNotes: boolean };

export function createAccountantExport(
  records: readonly ReconciliationResult[],
  options: { date: Date; statusFilter: ExportScope | null } & AccountantCsvOptions
): AccountantExport {
  if (records.length === 0) return { ok: false, reason: "empty" };
  const includesReviewerNotes = Boolean(options.review);
  return {
    ok: true,
    includesReviewerNotes,
    filename: accountantExportFilename(options.date, options.statusFilter, includesReviewerNotes),
    content: buildAccountantCsv(records, { review: options.review }),
    recordCount: records.length,
    totals: summarizeByCurrency(records)
  };
}
