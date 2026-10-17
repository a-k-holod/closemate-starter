import { checkVatSum, expectedVat, VAT_ROUNDING_TOLERANCE_MINOR, type VatRate } from "./invoice";
import type { Locale } from "./locale";
import { formatMoney, isCurrency } from "./money";
import type { ReconciliationResult, ReviewReason } from "./reconcile";

const VAT_RATE_PL: Record<VatRate, string> = {
  "23": "23%",
  "8": "8%",
  "5": "5%",
  "0": "0%",
  zw: "zwolniony (zw)",
  np: "niepodlegający polskiemu VAT (np)"
};

function money(result: ReconciliationResult, amountMinor: number): string {
  const { currency } = result.invoice;
  return isCurrency(currency) ? formatMoney(amountMinor, currency, "pl") : String(amountMinor);
}

function sharedPaymentIds(message: string): string {
  return /^Bank payment (.+) exactly matches more than one invoice/.exec(message)?.[1] ?? "";
}

function polishReviewReason(result: ReconciliationResult, reason: ReviewReason): string {
  const { invoice } = result;
  switch (reason.code) {
    case "invalid_amount":
      return "Netto, VAT i brutto muszą być całkowitymi jednostkami mniejszymi (grosze/centy).";
    case "non_positive_amount":
      return "Brutto musi być dodatnie, a netto i VAT nieujemne; faktury korygujące wymagają ręcznej obsługi.";
    case "vat_sum_mismatch": {
      const sum = checkVatSum(invoice);
      return `Netto + VAT (${money(result, invoice.netMinor + invoice.vatMinor)}) różni się od brutto (${money(result, invoice.grossMinor)}) o ${money(result, Math.abs(sum.differenceMinor))}, powyżej tolerancji zaokrąglenia ${money(result, VAT_ROUNDING_TOLERANCE_MINOR)}.`;
    }
    case "vat_rate_mismatch": {
      const rate = invoice.vatRate;
      const label = rate in VAT_RATE_PL ? VAT_RATE_PL[rate as VatRate] : String(rate);
      const expected = rate in VAT_RATE_PL ? expectedVat(invoice.netMinor, rate as VatRate) : invoice.vatMinor;
      return `VAT na dokumencie (${money(result, invoice.vatMinor)}) nie zgadza się ze stawką ${label} (oczekiwano ${money(result, expected)}).`;
    }
    case "invalid_vat_rate":
      return `Stawka VAT ${String(invoice.vatRate)} nie jest obsługiwaną polską stawką (23, 8, 5, 0, zw, np).`;
    case "invalid_nip":
      return `NIP dostawcy ${invoice.vendorNip ?? ""} nie przechodzi sumy kontrolnej.`.replace("  ", " ");
    case "missing_nip":
      return "Polski dostawca nie ma NIP w ewidencji.";
    case "invalid_date":
      return "Data wystawienia i termin płatności muszą być poprawnymi datami YYYY-MM-DD.";
    case "due_before_issue":
      return "Termin płatności jest wcześniejszy niż data wystawienia.";
    case "unsupported_currency":
      return `Waluta ${String(invoice.currency)} nie jest obsługiwana (tylko PLN, EUR i USD).`;
    case "duplicate_invoice_number":
      return `Numer faktury ${invoice.number} od tego dostawcy jest zapisany więcej niż raz.`;
    case "cross_currency_payment": {
      const found = result.crossCurrencyPayments.map((payment) => `${payment.id} (${formatMoney(payment.amountMinor, payment.currency, "pl")})`).join(", ");
      return `Powiązany dowód bankowy jest w innej walucie: ${found}. Płatności nigdy nie są uzgadniane między walutami.`;
    }
    case "shared_payment":
      return `Płatność bankowa ${sharedPaymentIds(reason.message)} dokładnie odpowiada więcej niż jednej fakturze, więc nie jest liczona dla żadnej z nich, dopóki nie przypisze jej osoba.`;
    default: {
      const unreachable: never = reason.code;
      return unreachable;
    }
  }
}

/** English keeps the stored reconciliation sentence. Polish is rebuilt from the same facts. */
export function displayReviewReason(result: ReconciliationResult, reason: ReviewReason, locale: Locale): string {
  return locale === "pl" ? polishReviewReason(result, reason) : reason.message;
}
