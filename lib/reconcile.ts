import { DEMO_AS_OF, demoBankPayments, demoInvoices } from "./demo-data";
import { daysBetween, normalizeNip, validateInvoice, VAT_ROUNDING_TOLERANCE_MINOR, type BankPayment, type Invoice, type ValidationIssueCode } from "./invoice";
import { formatMoney, sumSameCurrency, type MinorUnits } from "./money";

export type { BankPayment, Invoice } from "./invoice";
/** @deprecated Use BankPayment. */
export type Payment = BankPayment;

export type ReconciliationStatus = "matched" | "amount_mismatch" | "missing_payment" | "possible_duplicate" | "needs_review";

export const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = ["matched", "amount_mismatch", "missing_payment", "possible_duplicate", "needs_review"];

export type ReviewReasonCode = ValidationIssueCode | "cross_currency_payment" | "shared_payment";
export type ReviewReason = { code: ReviewReasonCode; message: string };

/** "settled" means bank evidence covers the gross amount; it says nothing about tax treatment. */
export type DueState = "settled" | "not_due" | "due_today" | "overdue";

export type DueInfo = {
  state: DueState;
  /** Calendar days from the due date to the as-of date; positive when past due. */
  daysPastDue: number;
};

export type ReconciliationResult = {
  invoice: Invoice;
  status: ReconciliationStatus;
  /** Same-currency bank evidence linked to this invoice. Never contains another currency. */
  matchedPayments: BankPayment[];
  /** Payments that look related but are in a different currency; shown as evidence, never matched. */
  crossCurrencyPayments: BankPayment[];
  /** Linked payment total minus invoice gross, in the invoice currency's minor units. */
  deltaMinor: MinorUnits;
  reviewReasons: ReviewReason[];
  due: DueInfo;
  explanation: string;
};

export type ReconcileOptions = {
  /** Date (YYYY-MM-DD) used for due-date checks. Defaults to today in UTC. */
  asOf?: string;
  toleranceMinor?: MinorUnits;
};

const MIN_PARTIAL_MATCH_LENGTH = 4;

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ł/g, "l").replace(/[^a-z0-9]/g, "");
}

function referenceTokens(invoice: Invoice): string[] {
  return [invoice.id, invoice.number, invoice.vendorNip ?? ""].map(normalize).filter((t) => t.length >= MIN_PARTIAL_MATCH_LENGTH);
}

function vendorsMatch(invoiceVendor: string, counterparty: string): boolean {
  const a = normalize(invoiceVendor);
  const b = normalize(counterparty);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PARTIAL_MATCH_LENGTH && longer.includes(shorter);
}

/** Currency-agnostic relatedness: the payment references this invoice or comes from its vendor. */
function relatedTo(invoice: Invoice, payment: BankPayment, allInvoices: readonly Invoice[]): boolean {
  const reference = normalize(payment.reference);
  if (referenceTokens(invoice).some((t) => reference.includes(t))) return true;
  // A transfer that explicitly names a different invoice belongs to that invoice, not to every invoice from the vendor.
  const namesAnotherInvoice = allInvoices.some((other) => other !== invoice && [other.id, other.number].map(normalize).some((t) => t.length >= MIN_PARTIAL_MATCH_LENGTH && reference.includes(t)));
  if (namesAnotherInvoice) return false;
  return vendorsMatch(invoice.vendor, payment.counterparty);
}

function duplicateInvoiceKeys(invoices: readonly Invoice[]): Set<string> {
  const seen = new Map<string, number>();
  for (const invoice of invoices) {
    const key = invoiceKey(invoice);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
}

function invoiceKey(invoice: Invoice): string {
  return `${invoice.vendorNip ? normalizeNip(invoice.vendorNip) : normalize(invoice.vendor)}|${normalize(invoice.number)}`;
}

export function dueInfo(invoice: Invoice, status: ReconciliationStatus, asOf: string): DueInfo {
  const daysPastDue = daysBetween(invoice.dueAt, asOf);
  if (status === "matched" || status === "possible_duplicate") return { state: "settled", daysPastDue };
  if (daysPastDue > 0) return { state: "overdue", daysPastDue };
  if (daysPastDue === 0) return { state: "due_today", daysPastDue };
  return { state: "not_due", daysPastDue };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function reconcile(invoicesInput: Invoice[], paymentsInput: BankPayment[], options: ReconcileOptions = {}): ReconciliationResult[] {
  const asOf = options.asOf ?? todayUtc();
  const tolerance = options.toleranceMinor ?? VAT_ROUNDING_TOLERANCE_MINOR;
  const duplicateKeys = duplicateInvoiceKeys(invoicesInput);

  const linked = invoicesInput.map((invoice) => {
    const related = paymentsInput.filter((payment) => relatedTo(invoice, payment, invoicesInput));
    return {
      invoice,
      sameCurrency: related.filter((payment) => payment.currency === invoice.currency),
      crossCurrencyPayments: related.filter((payment) => payment.currency !== invoice.currency)
    };
  });
  // One bank payment can settle at most one invoice: count how many invoices each payment matches exactly.
  const exactClaims = new Map<BankPayment, number>();
  for (const { invoice, sameCurrency } of linked) {
    for (const payment of sameCurrency) {
      if (payment.amountMinor === invoice.grossMinor) exactClaims.set(payment, (exactClaims.get(payment) ?? 0) + 1);
    }
  }

  return linked.map(({ invoice, sameCurrency, crossCurrencyPayments }) => {
    const { currency, grossMinor } = invoice;
    const money = (amountMinor: MinorUnits) => formatMoney(amountMinor, currency);
    const isExact = (payment: BankPayment) => payment.amountMinor === grossMinor;
    // A payment that exactly matches another invoice is that invoice's evidence, not a partial payment of this one.
    const available = sameCurrency.filter((payment) => isExact(payment) || !exactClaims.has(payment));
    const shared = available.filter((payment) => isExact(payment) && (exactClaims.get(payment) ?? 0) > 1);
    const candidates = available.filter((payment) => !shared.includes(payment));
    const total = (payments: BankPayment[]) => sumSameCurrency(payments, currency);

    const reviewReasons: ReviewReason[] = validateInvoice(invoice, tolerance);
    if (duplicateKeys.has(invoiceKey(invoice))) {
      reviewReasons.push({ code: "duplicate_invoice_number", message: `Invoice number ${invoice.number} from this vendor is recorded more than once.` });
    }
    if (shared.length > 0) {
      reviewReasons.push({
        code: "shared_payment",
        message: `Bank payment ${shared.map((p) => p.id).join(", ")} exactly matches more than one invoice, so it is not counted for any of them until a person assigns it.`
      });
    }

    const build = (status: ReconciliationStatus, matchedPayments: BankPayment[], explanation: string): ReconciliationResult => ({
      invoice,
      status,
      matchedPayments,
      crossCurrencyPayments,
      deltaMinor: total(matchedPayments) - grossMinor,
      reviewReasons,
      due: dueInfo(invoice, status, asOf),
      explanation
    });

    if (reviewReasons.length > 0) {
      return build("needs_review", candidates, `Invoice data needs manual review before matching: ${reviewReasons.map((r) => r.message).join(" ")}`);
    }

    const exact = candidates.filter((payment) => payment.amountMinor === grossMinor);
    if (exact.length > 1) {
      return build("possible_duplicate", exact, `${exact.length} payments of ${money(grossMinor)} reference this invoice.`);
    }
    if (exact.length === 1) {
      return build("matched", exact, "Invoice gross and payment amounts match.");
    }
    if (candidates.length > 0) {
      const closest = [...candidates].sort((a, b) => Math.abs(a.amountMinor - grossMinor) - Math.abs(b.amountMinor - grossMinor))[0];
      return build("amount_mismatch", [closest], `Invoice gross is ${money(grossMinor)} but candidate payment is ${money(closest.amountMinor)}.`);
    }
    if (crossCurrencyPayments.length > 0) {
      const found = crossCurrencyPayments.map((p) => `${p.id} (${formatMoney(p.amountMinor, p.currency)})`).join(", ");
      reviewReasons.push({
        code: "cross_currency_payment",
        message: `Related bank evidence is in a different currency: ${found}. Payments are never matched across currencies.`
      });
      return build("needs_review", [], `Invoice is in ${currency}; related payment evidence is in another currency and was not matched.`);
    }
    return build("missing_payment", [], "No likely payment was found in the imported bank activity.");
  });
}

export const invoices = demoInvoices;
export const payments = demoBankPayments;
export const results = reconcile(invoices, payments, { asOf: DEMO_AS_OF });

export { demoExplanation } from "./explanations";
