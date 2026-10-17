export type Invoice = {
  id: string;
  vendor: string;
  amount: number;
  currency: "USD";
  issuedAt: string;
  dueAt: string;
};

export type Payment = {
  id: string;
  vendor: string;
  amount: number;
  currency: "USD";
  date: string;
  reference: string;
};

export type ReconciliationStatus = "matched" | "amount_mismatch" | "missing_payment" | "possible_duplicate";

export type ReconciliationResult = {
  invoice: Invoice;
  status: ReconciliationStatus;
  matchedPayments: Payment[];
  delta: number;
  explanation: string;
};

export const invoices: Invoice[] = [
  { id: "INV-2041", vendor: "Atlas Cloud", amount: 1200, currency: "USD", issuedAt: "2026-09-28", dueAt: "2026-10-15" },
  { id: "INV-2042", vendor: "Northstar Analytics", amount: 2480, currency: "USD", issuedAt: "2026-09-30", dueAt: "2026-10-16" },
  { id: "INV-2043", vendor: "Cedar Workspace", amount: 89, currency: "USD", issuedAt: "2026-10-01", dueAt: "2026-10-18" },
  { id: "INV-2044", vendor: "Mercury Design", amount: 750, currency: "USD", issuedAt: "2026-10-02", dueAt: "2026-10-18" },
  { id: "INV-2045", vendor: "Oceanic Studio", amount: 640, currency: "USD", issuedAt: "2026-10-03", dueAt: "2026-10-19" },
  { id: "INV-2046", vendor: "Lakeview Hosting", amount: 399, currency: "USD", issuedAt: "2026-10-05", dueAt: "2026-10-20" }
];

export const payments: Payment[] = [
  { id: "TXN-8101", vendor: "ATLAS CLOUD INC", amount: 1200, currency: "USD", date: "2026-10-13", reference: "INV-2041 / monthly cloud" },
  { id: "TXN-8102", vendor: "Northstar Analytics LLC", amount: 2840, currency: "USD", date: "2026-10-14", reference: "NORTHSTAR INV-2042" },
  { id: "TXN-8103", vendor: "Mercury Design", amount: 750, currency: "USD", date: "2026-10-14", reference: "INV-2044" },
  { id: "TXN-8104", vendor: "Mercury Design", amount: 750, currency: "USD", date: "2026-10-15", reference: "INV-2044 second transfer" },
  { id: "TXN-8105", vendor: "OCEANIC STUDIO LLC", amount: 640, currency: "USD", date: "2026-10-14", reference: "INV-2045 / design work" },
  { id: "TXN-8106", vendor: "Lakeview Hosting", amount: 399, currency: "USD", date: "2026-10-15", reference: "October hosting" }
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function candidateFor(invoice: Invoice, payment: Payment): boolean {
  if (invoice.currency !== payment.currency) return false;
  const normalizedInvoiceId = normalize(invoice.id);
  const normalizedReference = normalize(payment.reference);
  const invoiceVendor = normalize(invoice.vendor);
  const paymentVendor = normalize(payment.vendor);
  const referenceMatch = normalizedReference.includes(normalizedInvoiceId);
  const vendorMatch = paymentVendor === invoiceVendor || paymentVendor.includes(invoiceVendor) || invoiceVendor.includes(paymentVendor);
  return referenceMatch || vendorMatch;
}

export function reconcile(invoicesInput: Invoice[], paymentsInput: Payment[]): ReconciliationResult[] {
  return invoicesInput.map((invoice) => {
    const candidates = paymentsInput.filter((payment) => candidateFor(invoice, payment));
    const exact = candidates.filter((payment) => Math.abs(payment.amount - invoice.amount) < 0.005);
    if (exact.length > 1) {
      return {
        invoice,
        status: "possible_duplicate",
        matchedPayments: exact,
        delta: exact.reduce((sum, payment) => sum + payment.amount, 0) - invoice.amount,
        explanation: `${exact.length} payments of ${invoice.currency} ${invoice.amount.toFixed(2)} reference this invoice.`
      };
    }
    if (exact.length === 1) {
      return { invoice, status: "matched", matchedPayments: exact, delta: 0, explanation: "Invoice and payment amounts match." };
    }
    if (candidates.length > 0) {
      const closest = [...candidates].sort((a, b) => Math.abs(a.amount - invoice.amount) - Math.abs(b.amount - invoice.amount))[0];
      return {
        invoice,
        status: "amount_mismatch",
        matchedPayments: [closest],
        delta: closest.amount - invoice.amount,
        explanation: `Invoice is ${invoice.currency} ${invoice.amount.toFixed(2)} but candidate payment is ${invoice.currency} ${closest.amount.toFixed(2)}.`
      };
    }
    return { invoice, status: "missing_payment", matchedPayments: [], delta: -invoice.amount, explanation: "No likely payment was found in the imported bank activity." };
  });
}

export const results = reconcile(invoices, payments);

export function demoExplanation(result: ReconciliationResult): string {
  const amount = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  switch (result.status) {
    case "amount_mismatch": {
      const payment = result.matchedPayments[0];
      const absoluteDelta = Math.abs(result.delta);
      const direction = result.delta > 0 ? "higher" : "lower";
      return `${result.invoice.id} needs review: the invoice is ${amount(result.invoice.amount)}, while ${payment?.id ?? "the candidate payment"} is ${amount(payment?.amount ?? 0)} (${amount(absoluteDelta)} ${direction}). Keep this item open and compare tax, a credit note, or a duplicate charge before approving any adjustment. No payment or refund has been initiated.`;
    }
    case "missing_payment":
      return `No matching bank payment was found for ${result.invoice.vendor} (${result.invoice.id}, ${amount(result.invoice.amount)}). Check whether the payment is still pending, posted under a different vendor name, or missing from the imported statement. Do not mark it paid without evidence.`;
    case "possible_duplicate":
      return `${result.matchedPayments.length} separate payments reference ${result.invoice.id}. The invoice is ${amount(result.invoice.amount)} but the candidate payments total ${amount(result.matchedPayments.reduce((s, p) => s + p.amount, 0))}. Verify both transactions against the bank and vendor ledger before requesting a recall or refund.`;
    case "matched":
      return `${result.invoice.id} is matched: invoice and payment values agree at ${amount(result.invoice.amount)}. Keep the bank transaction reference as the audit evidence.`;
  }
}
