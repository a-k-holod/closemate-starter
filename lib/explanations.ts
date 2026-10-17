import { formatDate } from "./invoice";
import type { Locale } from "./locale";
import { formatMoney, sumSameCurrency, type MinorUnits } from "./money";
import { displayReviewReason } from "./review-copy";
import type { ReconciliationResult } from "./reconcile";

function polishDays(count: number): string {
  const abs = Math.abs(count);
  if (abs === 1) return "dzień";
  return "dni";
}

function dueSentence(result: ReconciliationResult, locale: Locale): string {
  const { due, invoice } = result;
  const dueDate = formatDate(invoice.dueAt, "long", locale);
  if (locale === "pl") {
    if (due.state === "overdue") return ` Termin płatności (${dueDate}) minął o ${due.daysPastDue} ${polishDays(due.daysPastDue)}.`;
    if (due.state === "due_today") return ` Termin płatności przypada dzisiaj (${dueDate}).`;
    if (due.state === "not_due") return ` Termin płatności jeszcze nie minął (${dueDate}).`;
    return "";
  }
  if (due.state === "overdue") return ` It is ${due.daysPastDue} day${due.daysPastDue === 1 ? "" : "s"} past its ${dueDate} due date.`;
  if (due.state === "due_today") return ` It is due today (${dueDate}).`;
  if (due.state === "not_due") return ` It is not yet due (${dueDate}).`;
  return "";
}

/** Deterministic, rule-based explanation. Describes evidence only; makes no tax determinations. */
export function demoExplanation(result: ReconciliationResult, locale: Locale = "en"): string {
  const { invoice } = result;
  const amount = (value: MinorUnits) => formatMoney(value, invoice.currency, locale);
  const paymentsTotal = sumSameCurrency(result.matchedPayments, invoice.currency);
  const due = dueSentence(result, locale);
  if (locale === "pl") {
    switch (result.status) {
      case "amount_mismatch": {
        const payment = result.matchedPayments[0];
        const absoluteDelta = Math.abs(result.deltaMinor);
        const direction = result.deltaMinor > 0 ? "więcej" : "mniej";
        const netHint = payment && payment.amountMinor === invoice.netMinor && invoice.vatMinor > 0
          ? ` Przelew jest równy kwocie netto faktury, więc część VAT ${amount(invoice.vatMinor)} mogła nie zostać zapłacona.`
          : "";
        return `${invoice.id} wymaga weryfikacji: brutto faktury to ${amount(invoice.grossMinor)}, a ${payment?.id ?? "płatność kandydacka"} wynosi ${amount(payment?.amountMinor ?? 0)} (${amount(absoluteDelta)} ${direction}).${netHint}${due} Pozostaw tę pozycję otwartą i sprawdź częściową płatność, fakturę korygującą albo opłatę bankową, zanim zatwierdzisz jakąkolwiek korektę. Żadna płatność ani zwrot nie zostały zainicjowane.`;
      }
      case "missing_payment":
        return `Nie znaleziono pasującej płatności bankowej dla ${invoice.vendor} (${invoice.number}, ${amount(invoice.grossMinor)}).${due} Sprawdź, czy płatność jest jeszcze w toku, zaksięgowana pod inną nazwą kontrahenta albo brakuje jej w zaimportowanym wyciągu. Nie oznaczaj faktury jako opłaconej bez dowodu.`;
      case "possible_duplicate":
        return `${result.matchedPayments.length} osobne płatności wskazują na ${invoice.number}. Brutto faktury to ${amount(invoice.grossMinor)}, ale płatności kandydackie sumują się do ${amount(paymentsTotal)} (${amount(result.deltaMinor)} nadwyżki). Zweryfikuj transakcje z wyciągiem bankowym i dostawcą, zanim poprosisz o zwrot lub potrącenie z przyszłej faktury.`;
      case "needs_review": {
        const reasons = result.reviewReasons.map((reason) => displayReviewReason(result, reason, "pl")).join(" ");
        return `${invoice.id} jest wstrzymana do ręcznej weryfikacji i nie została uzgodniona. ${reasons}${due} Potwierdź dokument u dostawcy lub u księgowego, zanim oprzesz na nim zamknięcie.`;
      }
      case "matched":
        return `${invoice.id} jest uzgodniona: brutto faktury i płatność bankowa zgadzają się na kwotę ${amount(invoice.grossMinor)}. Zachowaj referencję transakcji bankowej jako dowód płatności.`;
    }
  }
  switch (result.status) {
    case "amount_mismatch": {
      const payment = result.matchedPayments[0];
      const absoluteDelta = Math.abs(result.deltaMinor);
      const direction = result.deltaMinor > 0 ? "higher" : "lower";
      const netHint = payment && payment.amountMinor === invoice.netMinor && invoice.vatMinor > 0
        ? ` The transfer equals the invoice net amount, so the ${amount(invoice.vatMinor)} VAT portion may not have been paid.`
        : "";
      return `${invoice.id} needs review: the invoice gross is ${amount(invoice.grossMinor)}, while ${payment?.id ?? "the candidate payment"} is ${amount(payment?.amountMinor ?? 0)} (${amount(absoluteDelta)} ${direction}).${netHint}${due} Keep this item open and check for a partial payment, a correction invoice, or a bank fee before approving any adjustment. No payment or refund has been initiated.`;
    }
    case "missing_payment":
      return `No matching bank payment was found for ${invoice.vendor} (${invoice.number}, ${amount(invoice.grossMinor)}).${due} Check whether the payment is still pending, posted under a different counterparty name, or missing from the imported statement. Do not mark it paid without evidence.`;
    case "possible_duplicate":
      return `${result.matchedPayments.length} separate payments reference ${invoice.number}. The invoice gross is ${amount(invoice.grossMinor)} but the candidate payments total ${amount(paymentsTotal)} (${amount(result.deltaMinor)} extra). Verify the transactions against the bank statement and the vendor before requesting a refund or offsetting a future invoice.`;
    case "needs_review": {
      const reasons = result.reviewReasons.map((reason) => reason.message).join(" ");
      return `${invoice.id} is held for manual review and has not been matched. ${reasons}${due} Confirm the document with the vendor or your accountant before relying on it in the close.`;
    }
    case "matched":
      return `${invoice.id} is matched: invoice gross and bank payment agree at ${amount(invoice.grossMinor)}. Keep the bank transaction reference as the payment evidence.`;
  }
}
