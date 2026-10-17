import { EXPENSE_CATEGORIES, normalizeNip } from "./invoice";
import { CURRENCIES, sumSameCurrency, type Currency, type MinorUnits } from "./money";
import type { ReconciliationResult } from "./reconcile";
import type { ReviewDecision } from "./review-state";

export const REVIEW_FILTERS = ["all", "matched", "amount_mismatch", "missing_payment", "possible_duplicate", "overdue", "needs_review"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = {
  all: "All invoices",
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  missing_payment: "Missing payment",
  possible_duplicate: "Possible duplicate",
  overdue: "Overdue",
  needs_review: "Needs review"
};

export type ReviewDecisions = Readonly<Record<string, ReviewDecision | undefined>>;

/**
 * Where a record sits in the reviewer's queue:
 * - reviewed: signed off by the reviewer
 * - flagged: explicitly marked "needs review" by the reviewer
 * - awaiting: an exception or overdue item nobody has signed off yet
 * - not_required: matched, not overdue, and untouched
 */
export type ReviewQueueState = "reviewed" | "flagged" | "awaiting" | "not_required";

export function requiresReview(result: ReconciliationResult): boolean {
  return result.status !== "matched" || result.due.state === "overdue";
}

export function reviewQueueState(result: ReconciliationResult, decision: ReviewDecision | undefined): ReviewQueueState {
  if (decision === "reviewed") return "reviewed";
  if (decision === "needs_review") return "flagged";
  return requiresReview(result) ? "awaiting" : "not_required";
}

/** Lowercase, strip diacritics (including Polish ł) and punctuation, so "wisniewska" finds "Wiśniewska". */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]/g, "");
}

/** Matches invoice ID or number, vendor name, NIP (with or without dashes / PL prefix) and category (English or Polish). */
export function matchesSearch(result: ReconciliationResult, query: string): boolean {
  const folded = foldSearchText(query);
  if (!folded) return true;
  const { invoice } = result;
  const category = EXPENSE_CATEGORIES[invoice.category];
  const textFields = [invoice.id, invoice.number, invoice.vendor, category?.label ?? invoice.category, category?.polish ?? ""];
  if (textFields.some((field) => foldSearchText(field).includes(folded))) return true;
  if (!invoice.vendorNip) return false;
  const nipQuery = normalizeNip(query.trim());
  return /^\d+$/.test(nipQuery) && normalizeNip(invoice.vendorNip).includes(nipQuery);
}

export function matchesFilter(result: ReconciliationResult, filter: ReviewFilter, decisions: ReviewDecisions): boolean {
  switch (filter) {
    case "all":
      return true;
    case "overdue":
      return result.due.state === "overdue";
    case "needs_review": {
      const state = reviewQueueState(result, decisions[result.invoice.id]);
      return state === "awaiting" || state === "flagged";
    }
    default:
      return result.status === filter;
  }
}

export function filterResults(results: readonly ReconciliationResult[], query: string, filter: ReviewFilter, decisions: ReviewDecisions): ReconciliationResult[] {
  return results.filter((r) => matchesSearch(r, query) && matchesFilter(r, filter, decisions));
}

/** Count per filter for the records that match the current search, so chip counts always agree with the list. */
export function countByFilter(results: readonly ReconciliationResult[], query: string, decisions: ReviewDecisions): Record<ReviewFilter, number> {
  const searched = results.filter((r) => matchesSearch(r, query));
  return Object.fromEntries(REVIEW_FILTERS.map((f) => [f, searched.filter((r) => matchesFilter(r, f, decisions)).length])) as Record<ReviewFilter, number>;
}

export type CurrencySummary = {
  currency: Currency;
  invoiceCount: number;
  grossMinor: MinorUnits;
  /** Same-currency bank evidence linked to these invoices. */
  paidMinor: MinorUnits;
  /** Sum of per-invoice shortfalls; an overpayment on one invoice never offsets another. */
  unpaidMinor: MinorUnits;
  /** Sum of per-invoice excess payments (duplicates, overpayments). */
  overpaidMinor: MinorUnits;
};

/** Per-currency totals in PLN, EUR, USD order. Currencies with no records are omitted; amounts are never combined across currencies. */
export function summarizeByCurrency(results: readonly ReconciliationResult[]): CurrencySummary[] {
  const byCurrency = new Map<Currency, CurrencySummary>();
  for (const result of results) {
    const { currency, grossMinor } = result.invoice;
    const paid = sumSameCurrency(result.matchedPayments, currency);
    const summary = byCurrency.get(currency) ?? { currency, invoiceCount: 0, grossMinor: 0, paidMinor: 0, unpaidMinor: 0, overpaidMinor: 0 };
    summary.invoiceCount += 1;
    summary.grossMinor += grossMinor;
    summary.paidMinor += paid;
    summary.unpaidMinor += Math.max(0, grossMinor - paid);
    summary.overpaidMinor += Math.max(0, paid - grossMinor);
    byCurrency.set(currency, summary);
  }
  return CURRENCIES.flatMap((currency) => byCurrency.get(currency) ?? []);
}

export function countReviewQueue(results: readonly ReconciliationResult[], decisions: ReviewDecisions): Record<ReviewQueueState, number> {
  const counts: Record<ReviewQueueState, number> = { reviewed: 0, flagged: 0, awaiting: 0, not_required: 0 };
  for (const result of results) counts[reviewQueueState(result, decisions[result.invoice.id])] += 1;
  return counts;
}
