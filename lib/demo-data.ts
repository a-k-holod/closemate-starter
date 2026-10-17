import type { BankPayment, Invoice } from "./invoice";
import { toMinorUnits, type Currency } from "./money";

/**
 * Synthetic data only. Vendor names are fictional and every NIP uses the unissued
 * "000" tax-office prefix, so none can belong to a real business.
 */

/** Fixed reconciliation date so the demo and tests are deterministic. */
export const DEMO_AS_OF = "2026-10-17";

export const DEMO_BUSINESS = { name: "Nowak Studio", form: "JDG", owner: "Anna Nowak (demo)" };

function amounts(currency: Currency, net: string, vat: string, gross: string) {
  return {
    currency,
    netMinor: toMinorUnits(net, currency),
    vatMinor: toMinorUnits(vat, currency),
    grossMinor: toMinorUnits(gross, currency)
  };
}

function paid(currency: Currency, amount: string) {
  return { currency, amountMinor: toMinorUnits(amount, currency) };
}

export const demoInvoices: Invoice[] = [
  // Fully matched, with a fractional VAT amount (249.99 × 23% = 57.4977 → 57.50).
  { id: "INV-2101", number: "FV/2026/09/118", vendor: "Chmura Demo sp. z o.o.", vendorCountry: "PL", vendorNip: "0000000017", issuedAt: "2026-09-30", dueAt: "2026-10-14", ...amounts("PLN", "249.99", "57.50", "307.49"), vatRate: "23", category: "hosting" },
  // Amount mismatch: the transfer equals the net amount, so the VAT portion looks unpaid.
  { id: "INV-2102", number: "47/10/2026", vendor: "Biuro Rachunkowe Przykład", vendorCountry: "PL", vendorNip: "0000000023", issuedAt: "2026-10-01", dueAt: "2026-10-15", ...amounts("PLN", "600.00", "138.00", "738.00"), vatRate: "23", category: "accounting" },
  // Missing payment, not yet due.
  { id: "INV-2103", number: "F/10/88213/2026", vendor: "Telekom Demo S.A.", vendorCountry: "PL", vendorNip: "0000000046", issuedAt: "2026-10-08", dueAt: "2026-10-22", ...amounts("PLN", "99.99", "23.00", "122.99"), vatRate: "23", category: "telecom" },
  // Suspected duplicate payment: two transfers of the full gross amount.
  { id: "INV-2104", number: "FV/CW/2026/10/031", vendor: "Cowork Demo Kraków sp. z o.o.", vendorCountry: "PL", vendorNip: "0000000052", issuedAt: "2026-10-01", dueAt: "2026-10-10", ...amounts("PLN", "1200.00", "276.00", "1476.00"), vatRate: "23", category: "office_rent" },
  // Overdue: past due date with no bank evidence.
  { id: "INV-2105", number: "KD/2026/09/12", vendor: "Kancelaria Demo Wiśniewska", vendorCountry: "PL", vendorNip: "0000000069", issuedAt: "2026-09-20", dueAt: "2026-10-04", ...amounts("PLN", "1500.00", "345.00", "1845.00"), vatRate: "23", category: "legal" },
  // EUR-denominated expense from an EU vendor, paid from the EUR account.
  { id: "INV-2106", number: "DDT-2026-0098", vendor: "Demo Design Tools Ltd", vendorCountry: "IE", vendorNip: null, issuedAt: "2026-10-01", dueAt: "2026-10-08", ...amounts("EUR", "49.00", "0.00", "49.00"), vatRate: "np", category: "software" },
  // Zero-VAT: exempt training provider.
  { id: "INV-2107", number: "12/10/2026", vendor: "Szkolenia Demo Jan Przykładowy", vendorCountry: "PL", vendorNip: "0000000075", issuedAt: "2026-10-05", dueAt: "2026-10-19", ...amounts("PLN", "850.00", "0.00", "850.00"), vatRate: "zw", category: "training" },
  // Needs manual review: net + VAT = 1,230.00 but the document says gross 1,232.00.
  { id: "INV-2108", number: "FV/2026/10/0457", vendor: "Sprzęt IT Demo sp. z o.o.", vendorCountry: "PL", vendorNip: "0000000081", issuedAt: "2026-10-09", dueAt: "2026-10-23", ...amounts("PLN", "1000.00", "230.00", "1232.00"), vatRate: "23", category: "it_equipment" },
  // USD invoice settled by a PLN card payment: never matched across currencies, routed to review.
  { id: "INV-2109", number: "DAL-55120", vendor: "Demo API Labs Inc.", vendorCountry: "US", vendorNip: null, issuedAt: "2026-10-02", dueAt: "2026-10-16", ...amounts("USD", "20.00", "0.00", "20.00"), vatRate: "np", category: "software" }
];

export const demoBankPayments: BankPayment[] = [
  { id: "TXN-9101", counterparty: "CHMURA DEMO SP Z O O", ...paid("PLN", "307.49"), bookedAt: "2026-10-06", reference: "FV/2026/09/118 hosting", account: "PLN business account" },
  { id: "TXN-9102", counterparty: "BIURO RACHUNKOWE PRZYKLAD", ...paid("PLN", "600.00"), bookedAt: "2026-10-14", reference: "FV 47/10/2026 ksiegowosc pazdziernik", account: "PLN business account" },
  { id: "TXN-9103", counterparty: "COWORK DEMO KRAKOW SP Z O O", ...paid("PLN", "1476.00"), bookedAt: "2026-10-05", reference: "FV/CW/2026/10/031 czynsz", account: "PLN business account" },
  { id: "TXN-9104", counterparty: "COWORK DEMO KRAKOW SP Z O O", ...paid("PLN", "1476.00"), bookedAt: "2026-10-07", reference: "FV/CW/2026/10/031 coworking pazdziernik", account: "PLN business account" },
  { id: "TXN-9105", counterparty: "DEMO DESIGN TOOLS LTD", ...paid("EUR", "49.00"), bookedAt: "2026-10-03", reference: "DDT-2026-0098 subscription", account: "EUR business account" },
  { id: "TXN-9106", counterparty: "SZKOLENIA DEMO JAN PRZYKLADOWY", ...paid("PLN", "850.00"), bookedAt: "2026-10-12", reference: "FV 12/10/2026 szkolenie", account: "PLN business account" },
  { id: "TXN-9107", counterparty: "SPRZET IT DEMO SP Z O O", ...paid("PLN", "1232.00"), bookedAt: "2026-10-14", reference: "FV/2026/10/0457 monitor", account: "PLN business account" },
  { id: "TXN-9108", counterparty: "DEMO API LABS", ...paid("PLN", "81.42"), bookedAt: "2026-10-11", reference: "Card payment DAL-55120 USD 20.00", account: "PLN business account" }
];
