import { formatMoney, isCurrency, isMinorUnits, percentOf, type Currency, type MinorUnits } from "./money";

/**
 * VAT rate as printed on the purchase document. "zw" = exempt (zwolniony),
 * "np" = not subject to Polish VAT on the document (e.g. foreign vendor, reverse charge).
 * CloseMate only checks document arithmetic; it does not assess the buyer's VAT treatment.
 */
export const VAT_RATES = ["23", "8", "5", "0", "zw", "np"] as const;
export type VatRate = (typeof VAT_RATES)[number];

export const VAT_RATE_LABEL: Record<VatRate, string> = {
  "23": "23%",
  "8": "8%",
  "5": "5%",
  "0": "0%",
  zw: "Exempt (zw)",
  np: "Not subject to PL VAT (np)"
};

/** Operational expense categories for a JDG. Labels only; they do not decide tax deductibility. */
export const EXPENSE_CATEGORIES = {
  software: { label: "Software & SaaS", polish: "Oprogramowanie" },
  hosting: { label: "Hosting & cloud", polish: "Hosting i chmura" },
  accounting: { label: "Accounting services", polish: "Biuro rachunkowe" },
  telecom: { label: "Telecom & internet", polish: "Telekomunikacja" },
  office_rent: { label: "Office & coworking rent", polish: "Najem biura" },
  legal: { label: "Legal services", polish: "Usługi prawne" },
  training: { label: "Training & courses", polish: "Szkolenia" },
  it_equipment: { label: "IT equipment", polish: "Sprzęt IT" },
  marketing: { label: "Marketing & advertising", polish: "Marketing" },
  travel: { label: "Business travel", polish: "Podróże służbowe" }
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

/** A purchase invoice as recorded from the vendor's document. Contains no payment state. */
export type Invoice = {
  /** Internal CloseMate record ID. */
  id: string;
  /** Invoice number printed by the vendor, e.g. "FV/2026/10/031". */
  number: string;
  vendor: string;
  /** ISO 3166-1 alpha-2 country of the vendor. */
  vendorCountry: string;
  /** 10-digit Polish NIP; required for Polish vendors, null for foreign vendors without one. */
  vendorNip: string | null;
  issuedAt: string;
  dueAt: string;
  currency: Currency;
  netMinor: MinorUnits;
  vatMinor: MinorUnits;
  grossMinor: MinorUnits;
  vatRate: VatRate;
  category: ExpenseCategory;
};

/** A booked transaction from an imported bank statement, kept separate from invoices. */
export type BankPayment = {
  id: string;
  /** Counterparty name as it appears on the statement. */
  counterparty: string;
  amountMinor: MinorUnits;
  currency: Currency;
  bookedAt: string;
  /** Transfer title / statement description (tytuł przelewu). */
  reference: string;
  /** Statement or account the evidence was imported from. */
  account: string;
};

/**
 * Maximum allowed difference, in minor units, between net + VAT and gross.
 * Per-line rounding on multi-line invoices can legitimately leave a 1 grosz/cent gap.
 */
export const VAT_ROUNDING_TOLERANCE_MINOR = 1;

export type ValidationIssueCode =
  | "invalid_amount"
  | "non_positive_amount"
  | "vat_sum_mismatch"
  | "vat_rate_mismatch"
  | "invalid_nip"
  | "missing_nip"
  | "invalid_date"
  | "due_before_issue"
  | "unsupported_currency"
  | "duplicate_invoice_number";

export type ValidationIssue = { code: ValidationIssueCode; message: string };

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function normalizeNip(value: string): string {
  return value.replace(/^PL/i, "").replace(/[\s-]/g, "");
}

/** Polish NIP checksum: weighted sum of the first nine digits mod 11 equals the tenth digit. */
export function isValidNip(value: string): boolean {
  const nip = normalizeNip(value);
  if (!/^\d{10}$/.test(nip)) return false;
  const checksum = NIP_WEIGHTS.reduce((sum, weight, i) => sum + weight * Number(nip[i]), 0) % 11;
  return checksum !== 10 && checksum === Number(nip[9]);
}

export function formatNip(value: string): string {
  const nip = normalizeNip(value);
  return /^\d{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : value;
}

/** Strict calendar date check for "YYYY-MM-DD" strings. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). Timezone-independent. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatDate(value: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {})
  }).format(new Date(`${value}T00:00:00Z`));
}

export type VatCheck = {
  /** net + VAT − gross, in minor units. */
  differenceMinor: MinorUnits;
  withinTolerance: boolean;
};

export function checkVatSum(invoice: Pick<Invoice, "netMinor" | "vatMinor" | "grossMinor">, toleranceMinor = VAT_ROUNDING_TOLERANCE_MINOR): VatCheck {
  const differenceMinor = invoice.netMinor + invoice.vatMinor - invoice.grossMinor;
  return { differenceMinor, withinTolerance: Math.abs(differenceMinor) <= toleranceMinor };
}

/** Expected VAT for a single-rate document. Mixed-rate invoices are not modelled and will be flagged for review. */
export function expectedVat(netMinor: MinorUnits, rate: VatRate): MinorUnits {
  return rate === "zw" || rate === "np" ? 0 : percentOf(netMinor, Number(rate));
}

/** Arithmetic and identity checks on the document. Any issue routes the invoice to manual review. */
export function validateInvoice(invoice: Invoice, toleranceMinor = VAT_ROUNDING_TOLERANCE_MINOR): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isCurrency(invoice.currency)) {
    issues.push({ code: "unsupported_currency", message: `Currency ${String(invoice.currency)} is not supported (PLN, EUR, USD only).` });
  }

  const amountsAreIntegers = [invoice.netMinor, invoice.vatMinor, invoice.grossMinor].every(isMinorUnits);
  if (!amountsAreIntegers) {
    issues.push({ code: "invalid_amount", message: "Net, VAT and gross must be whole minor units (grosze/cents)." });
  } else {
    if (invoice.grossMinor <= 0 || invoice.netMinor < 0 || invoice.vatMinor < 0) {
      issues.push({ code: "non_positive_amount", message: "Gross must be positive and net/VAT non-negative; corrective invoices need manual handling." });
    }
    const money = (minor: MinorUnits) => (isCurrency(invoice.currency) ? formatMoney(minor, invoice.currency) : `${minor} minor units`);
    const sum = checkVatSum(invoice, toleranceMinor);
    if (!sum.withinTolerance) {
      issues.push({
        code: "vat_sum_mismatch",
        message: `Net + VAT (${money(invoice.netMinor + invoice.vatMinor)}) differs from gross (${money(invoice.grossMinor)}) by ${money(Math.abs(sum.differenceMinor))}, above the ${money(toleranceMinor)} rounding tolerance.`
      });
    }
    const expected = expectedVat(invoice.netMinor, invoice.vatRate);
    if (Math.abs(invoice.vatMinor - expected) > toleranceMinor) {
      issues.push({
        code: "vat_rate_mismatch",
        message: `VAT on the document (${money(invoice.vatMinor)}) does not match the stated ${VAT_RATE_LABEL[invoice.vatRate]} rate (expected ${money(expected)}).`
      });
    }
  }

  if (invoice.vendorNip === null) {
    if (invoice.vendorCountry === "PL") issues.push({ code: "missing_nip", message: "Polish vendor has no NIP on record." });
  } else if (!isValidNip(invoice.vendorNip)) {
    issues.push({ code: "invalid_nip", message: `Vendor NIP ${invoice.vendorNip} fails the checksum.` });
  }

  const datesValid = isIsoDate(invoice.issuedAt) && isIsoDate(invoice.dueAt);
  if (!datesValid) {
    issues.push({ code: "invalid_date", message: "Issue and due dates must be valid YYYY-MM-DD dates." });
  } else if (daysBetween(invoice.issuedAt, invoice.dueAt) < 0) {
    issues.push({ code: "due_before_issue", message: "Due date is earlier than the issue date." });
  }

  return issues;
}
