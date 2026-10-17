import { DEMO_AS_OF, demoBankPayments, demoInvoices } from "./demo-data";
import { daysBetween, formatDate, validateInvoice, VAT_ROUNDING_TOLERANCE_MINOR, type BankPayment, type Invoice, type ValidationIssueCode } from "./invoice";
import { formatMoney, sumSameCurrency, type MinorUnits } from "./money";

export type { BankPayment, Invoice } from "./invoice";
/** @deprecated Use BankPayment. */
export type Payment = BankPayment;

export type ReconciliationStatus = "matched" | "amount_mismatch" | "missing_payment" | "possible_duplicate" | "needs_review";

export const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = ["matched", "amount_mismatch", "missing_payment", "possible_duplicate", "needs_review"];

export type ReviewReason = { code: ValidationIssueCode | "cross_currency_payment"; message: string };

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
  return `${invoice.vendorNip ?? normalize(invoice.vendor)}|${normalize(invoice.number)}`;
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

  return invoicesInput.map((invoice) => {
    const { currency, grossMinor } = invoice;
    const money = (amountMinor: MinorUnits) => formatMoney(amountMinor, currency);
    const related = paymentsInput.filter((payment) => relatedTo(invoice, payment, invoicesInput));
    const candidates = related.filter((payment) => payment.currency === currency);
    const crossCurrencyPayments = related.filter((payment) => payment.currency !== currency);
    const total = (payments: BankPayment[]) => sumSameCurrency(payments, currency);

    const reviewReasons: ReviewReason[] = validateInvoice(invoice, tolerance);
    if (duplicateKeys.has(invoiceKey(invoice))) {
      reviewReasons.push({ code: "duplicate_invoice_number", message: `Invoice number ${invoice.number} from this vendor is recorded more than once.` });
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

function dueSentence(result: ReconciliationResult): string {
  const { due, invoice } = result;
  const dueDate = formatDate(invoice.dueAt, "long");
  if (due.state === "overdue") return ` It is ${due.daysPastDue} day${due.daysPastDue === 1 ? "" : "s"} past its ${dueDate} due date.`;
  if (due.state === "due_today") return ` It is due today (${dueDate}).`;
  if (due.state === "not_due") return ` It is not yet due (${dueDate}).`;
  return "";
}

/** Deterministic, rule-based explanation. Describes evidence only; makes no tax determinations. */
export function demoExplanation(result: ReconciliationResult): string {
  const { invoice } = result;
  const amount = (value: MinorUnits) => formatMoney(value, invoice.currency);
  const paymentsTotal = sumSameCurrency(result.matchedPayments, invoice.currency);
  switch (result.status) {
    case "amount_mismatch": {
      const payment = result.matchedPayments[0];
      const absoluteDelta = Math.abs(result.deltaMinor);
      const direction = result.deltaMinor > 0 ? "higher" : "lower";
      const netHint = payment && payment.amountMinor === invoice.netMinor && invoice.vatMinor > 0
        ? ` The transfer equals the invoice net amount, so the ${amount(invoice.vatMinor)} VAT portion may not have been paid.`
        : "";
      return `${invoice.id} needs review: the invoice gross is ${amount(invoice.grossMinor)}, while ${payment?.id ?? "the candidate payment"} is ${amount(payment?.amountMinor ?? 0)} (${amount(absoluteDelta)} ${direction}).${netHint}${dueSentence(result)} Keep this item open and check for a partial payment, a correction invoice, or a bank fee before approving any adjustment. No payment or refund has been initiated.`;
    }
    case "missing_payment":
      return `No matching bank payment was found for ${invoice.vendor} (${invoice.number}, ${amount(invoice.grossMinor)}).${dueSentence(result)} Check whether the payment is still pending, posted under a different counterparty name, or missing from the imported statement. Do not mark it paid without evidence.`;
    case "possible_duplicate":
      return `${result.matchedPayments.length} separate payments reference ${invoice.number}. The invoice gross is ${amount(invoice.grossMinor)} but the candidate payments total ${amount(paymentsTotal)} (${amount(result.deltaMinor)} extra). Verify the transactions against the bank statement and the vendor before requesting a refund or offsetting a future invoice.`;
    case "needs_review": {
      const reasons = result.reviewReasons.map((r) => r.message).join(" ");
      return `${invoice.id} is held for manual review and has not been matched. ${reasons}${dueSentence(result)} Confirm the document with the vendor or your accountant before relying on it in the close.`;
    }
    case "matched":
      return `${invoice.id} is matched: invoice gross and bank payment agree at ${amount(invoice.grossMinor)}. Keep the bank transaction reference as the payment evidence.`;
  }
}
