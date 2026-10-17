import { describe, expect, it } from "vitest";
import { DEMO_AS_OF } from "../lib/demo-data";
import type { BankPayment, Invoice } from "../lib/invoice";
import { toMinorUnits, type Currency } from "../lib/money";
import { demoExplanation, invoices, payments, RECONCILIATION_STATUSES, reconcile, results, type ReconciliationResult } from "../lib/reconcile";

const AS_OF = "2026-10-17";

function invoice(overrides: Partial<Invoice> & Pick<Invoice, "id">): Invoice {
  return {
    number: `FV/${overrides.id}`,
    vendor: "Test Vendor sp. z o.o.",
    vendorCountry: "PL",
    vendorNip: "0000000017",
    issuedAt: "2026-10-01",
    dueAt: "2026-10-15",
    currency: "PLN",
    netMinor: 100000,
    vatMinor: 23000,
    grossMinor: 123000,
    vatRate: "23",
    category: "software",
    ...overrides
  };
}

function payment(overrides: Partial<BankPayment> & Pick<BankPayment, "id" | "amountMinor">): BankPayment {
  return {
    counterparty: "TEST VENDOR SP Z O O",
    currency: "PLN",
    bookedAt: "2026-10-10",
    reference: "transfer",
    account: "PLN business account",
    ...overrides
  };
}

const run = (inv: Invoice[], pay: BankPayment[], asOf = AS_OF) => reconcile(inv, pay, { asOf });
const one = (inv: Invoice, pay: BankPayment[], asOf = AS_OF) => run([inv], pay, asOf)[0];

describe("reconciliation statuses", () => {
  it("matches one payment equal to the gross amount", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000 })]);
    expect(r.status).toBe("matched");
    expect(r.deltaMinor).toBe(0);
    expect(r.matchedPayments.map((p) => p.id)).toEqual(["P1"]);
    expect(r.due.state).toBe("settled");
  });

  it("matches on gross, not net", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 100000 })]);
    expect(r.status).toBe("amount_mismatch");
    expect(r.deltaMinor).toBe(-23000);
  });

  it("reports an amount mismatch against the closest candidate", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "FAR", amountMinor: 50000 }), payment({ id: "NEAR", amountMinor: 120000 })]);
    expect(r.status).toBe("amount_mismatch");
    expect(r.matchedPayments.map((p) => p.id)).toEqual(["NEAR"]);
    expect(r.deltaMinor).toBe(-3000);
  });

  it("treats a 1 grosz payment difference as a mismatch, not a match", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 122999 })]);
    expect(r.status).toBe("amount_mismatch");
    expect(r.deltaMinor).toBe(-1);
  });

  it("reports a missing payment when nothing related exists", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000, counterparty: "Someone Else", reference: "rent" })]);
    expect(r.status).toBe("missing_payment");
    expect(r.matchedPayments).toEqual([]);
    expect(r.deltaMinor).toBe(-123000);
  });

  it("flags several exact payments as a possible duplicate", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000 }), payment({ id: "P2", amountMinor: 123000, bookedAt: "2026-10-11" })]);
    expect(r.status).toBe("possible_duplicate");
    expect(r.matchedPayments).toHaveLength(2);
    expect(r.deltaMinor).toBe(123000);
  });

  it("sends invoices with inconsistent VAT to manual review even when a payment matches", () => {
    const r = one(invoice({ id: "A", grossMinor: 123200 }), [payment({ id: "P1", amountMinor: 123200 })]);
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons.map((x) => x.code)).toEqual(["vat_sum_mismatch"]);
    expect(r.matchedPayments.map((p) => p.id)).toEqual(["P1"]);
  });

  it("accepts net + VAT within the rounding tolerance", () => {
    const r = one(invoice({ id: "A", grossMinor: 123001 }), [payment({ id: "P1", amountMinor: 123001 })]);
    expect(r.status).toBe("matched");
  });

  it("covers every status with a defined label set", () => {
    expect(RECONCILIATION_STATUSES).toEqual(["matched", "amount_mismatch", "missing_payment", "possible_duplicate", "needs_review"]);
  });
});

describe("currencies", () => {
  it("never matches a payment in another currency, even with identical digits", () => {
    const r = one(invoice({ id: "A", currency: "EUR", vendorCountry: "IE", vendorNip: null, vatRate: "np", netMinor: 4900, vatMinor: 0, grossMinor: 4900 }), [
      payment({ id: "PLN", amountMinor: 4900, currency: "PLN" })
    ]);
    expect(r.status).toBe("needs_review");
    expect(r.matchedPayments).toEqual([]);
    expect(r.crossCurrencyPayments.map((p) => p.id)).toEqual(["PLN"]);
    expect(r.reviewReasons.map((x) => x.code)).toEqual(["cross_currency_payment"]);
  });

  it("ignores cross-currency evidence when a same-currency payment matches", () => {
    const r = one(invoice({ id: "A", currency: "USD", vendorCountry: "US", vendorNip: null, vatRate: "np", netMinor: 2000, vatMinor: 0, grossMinor: 2000 }), [
      payment({ id: "USD", amountMinor: 2000, currency: "USD" }),
      payment({ id: "PLN", amountMinor: 2000, currency: "PLN" })
    ]);
    expect(r.status).toBe("matched");
    expect(r.matchedPayments.map((p) => p.id)).toEqual(["USD"]);
    expect(r.crossCurrencyPayments.map((p) => p.id)).toEqual(["PLN"]);
  });

  it("does not count a cross-currency payment towards a duplicate", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000 }), payment({ id: "E1", amountMinor: 123000, currency: "EUR" })]);
    expect(r.status).toBe("matched");
  });

  it("keeps every matched payment in the invoice currency", () => {
    for (const r of results) {
      expect(r.matchedPayments.every((p) => p.currency === r.invoice.currency)).toBe(true);
      expect(r.crossCurrencyPayments.every((p) => p.currency !== r.invoice.currency)).toBe(true);
    }
  });

  it("matches fractional amounts in each supported currency exactly", () => {
    const cases: [Currency, string][] = [["PLN", "307.49"], ["EUR", "0.10"], ["USD", "19.99"]];
    for (const [currency, gross] of cases) {
      const grossMinor = toMinorUnits(gross, currency);
      const r = one(invoice({ id: "A", currency, vendorCountry: "IE", vendorNip: null, vatRate: "np", netMinor: grossMinor, vatMinor: 0, grossMinor }), [
        payment({ id: "P1", currency, amountMinor: toMinorUnits(Number(gross) * 3 / 3, currency) })
      ]);
      expect(r.status).toBe("matched");
    }
  });

  it("matches amounts that came from floating-point arithmetic once converted", () => {
    const gross = toMinorUnits(0.1 + 0.2, "PLN");
    const r = one(invoice({ id: "A", netMinor: gross, vatMinor: 0, grossMinor: gross, vatRate: "zw" }), [payment({ id: "P1", amountMinor: toMinorUnits("0.30", "PLN") })]);
    expect(r.status).toBe("matched");
  });
});

describe("candidate selection", () => {
  it("links payments by invoice number in the transfer title", () => {
    const r = one(invoice({ id: "A", number: "FV/2026/10/031" }), [payment({ id: "P1", amountMinor: 123000, counterparty: "Unrelated Name", reference: "Zaplata FV 2026/10/031" })]);
    expect(r.status).toBe("matched");
  });

  it("links payments that quote the vendor NIP", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000, counterparty: "X", reference: "/VAT/230,00/IDC/0000000017/INV/123" })]);
    expect(r.status).toBe("matched");
  });

  it("normalises Polish diacritics in vendor names", () => {
    const r = one(invoice({ id: "A", vendor: "Łódzka Pracownia Wiśniewski" }), [payment({ id: "P1", amountMinor: 123000, counterparty: "LODZKA PRACOWNIA WISNIEWSKI", reference: "x" })]);
    expect(r.status).toBe("matched");
  });

  it("does not treat a very short counterparty as a vendor match", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000, counterparty: "TE", reference: "x" })]);
    expect(r.status).toBe("missing_payment");
  });

  it("does not reuse a payment that names a different invoice from the same vendor", () => {
    const sept = invoice({ id: "SEP", number: "FV/2026/09/001", issuedAt: "2026-09-01", dueAt: "2026-09-15" });
    const oct = invoice({ id: "OCT", number: "FV/2026/10/001" });
    const [s, o] = run([sept, oct], [payment({ id: "P1", amountMinor: 123000, reference: "FV/2026/09/001" })]);
    expect(s.status).toBe("matched");
    expect(o.status).toBe("missing_payment");
  });
});

describe("duplicate detection", () => {
  it("flags the same vendor invoice number recorded twice", () => {
    const [a, b] = run([invoice({ id: "A", number: "FV/1" }), invoice({ id: "B", number: "fv 1" })], [payment({ id: "P1", amountMinor: 123000, reference: "x" })]);
    expect(a.status).toBe("needs_review");
    expect(b.status).toBe("needs_review");
    expect(a.reviewReasons.map((x) => x.code)).toContain("duplicate_invoice_number");
  });

  it("allows the same invoice number from different vendors", () => {
    const rs = run([invoice({ id: "A", number: "1/10/2026" }), invoice({ id: "B", number: "1/10/2026", vendor: "Other Vendor", vendorNip: "0000000023" })], []);
    expect(rs.map((r) => r.reviewReasons)).toEqual([[], []]);
  });

  it("explains a duplicate payment with the excess amount", () => {
    const r = one(invoice({ id: "A" }), [payment({ id: "P1", amountMinor: 123000 }), payment({ id: "P2", amountMinor: 123000 })]);
    expect(demoExplanation(r)).toContain("PLN 1,230.00 extra");
  });
});

describe("due dates", () => {
  const open = invoice({ id: "A", dueAt: "2026-10-15" });

  it("marks unpaid invoices past the due date as overdue", () => {
    const r = one(open, [], "2026-10-17");
    expect(r.due).toEqual({ state: "overdue", daysPastDue: 2 });
    expect(demoExplanation(r)).toContain("2 days past");
  });

  it("treats the due date itself as on time", () => {
    expect(one(open, [], "2026-10-15").due).toEqual({ state: "due_today", daysPastDue: 0 });
    expect(one(open, [], "2026-10-14").due).toEqual({ state: "not_due", daysPastDue: -1 });
    expect(demoExplanation(one(open, [], "2026-10-16"))).toContain("1 day past");
  });

  it("does not report settled invoices as overdue", () => {
    const r = one(open, [payment({ id: "P1", amountMinor: 123000, bookedAt: "2026-10-20" })], "2026-10-30");
    expect(r.due.state).toBe("settled");
  });

  it("keeps underpaid invoices open and overdue", () => {
    const r = one(open, [payment({ id: "P1", amountMinor: 100000 })], "2026-10-20");
    expect(r.status).toBe("amount_mismatch");
    expect(r.due.state).toBe("overdue");
  });
});

describe("JDG demo dataset", () => {
  const byId = (id: string) => results.find((r) => r.invoice.id === id) as ReconciliationResult;

  it("uses the fixed demo date", () => {
    expect(DEMO_AS_OF).toBe(AS_OF);
    expect(results).toEqual(reconcile(invoices, payments, { asOf: AS_OF }));
  });

  it("has at least eight invoices and covers every status", () => {
    expect(invoices.length).toBeGreaterThanOrEqual(8);
    expect(new Set(results.map((r) => r.status))).toEqual(new Set(RECONCILIATION_STATUSES));
  });

  it("produces the expected outcome for each scenario", () => {
    expect(results.map((r) => [r.invoice.id, r.status, r.due.state])).toEqual([
      ["INV-2101", "matched", "settled"],
      ["INV-2102", "amount_mismatch", "overdue"],
      ["INV-2103", "missing_payment", "not_due"],
      ["INV-2104", "possible_duplicate", "settled"],
      ["INV-2105", "missing_payment", "overdue"],
      ["INV-2106", "matched", "settled"],
      ["INV-2107", "matched", "settled"],
      ["INV-2108", "needs_review", "not_due"],
      ["INV-2109", "needs_review", "overdue"]
    ]);
  });

  it("covers the required scenarios", () => {
    expect(byId("INV-2101").invoice.grossMinor % 100).not.toBe(0);
    expect(byId("INV-2102").deltaMinor).toBe(-13800);
    expect(demoExplanation(byId("INV-2102"))).toContain("equals the invoice net amount");
    expect(byId("INV-2104").matchedPayments).toHaveLength(2);
    expect(byId("INV-2105").due.daysPastDue).toBe(13);
    expect(byId("INV-2106").invoice.currency).toBe("EUR");
    expect(byId("INV-2107").invoice.vatMinor).toBe(0);
    expect(byId("INV-2108").reviewReasons.map((x) => x.code)).toEqual(["vat_sum_mismatch"]);
    expect(byId("INV-2109").reviewReasons.map((x) => x.code)).toEqual(["cross_currency_payment"]);
    expect(new Set(invoices.map((i) => i.currency))).toEqual(new Set(["PLN", "EUR", "USD"]));
  });

  it("stores every amount as whole minor units with consistent VAT except the review case", () => {
    for (const r of results) {
      const { netMinor, vatMinor, grossMinor } = r.invoice;
      expect([netMinor, vatMinor, grossMinor].every(Number.isSafeInteger)).toBe(true);
      if (r.invoice.id !== "INV-2108") expect(netMinor + vatMinor).toBe(grossMinor);
    }
  });

  it("keeps explanations free of tax determinations and KSeF claims", () => {
    for (const r of results) {
      const text = demoExplanation(r).toLowerCase();
      expect(text).not.toMatch(/deductib|tax liability|ksef/);
      expect(text).not.toContain("NaN");
    }
  });
});

describe("legacy behaviour regression (original six-invoice USD dataset)", () => {
  const usd = (amount: number) => toMinorUnits(amount, "USD");
  const legacyInvoice = (id: string, vendor: string, amount: number, issuedAt: string, dueAt: string): Invoice => ({
    id, number: id, vendor, vendorCountry: "US", vendorNip: null, issuedAt, dueAt,
    currency: "USD", netMinor: usd(amount), vatMinor: 0, grossMinor: usd(amount), vatRate: "np", category: "software"
  });
  const legacyPayment = (id: string, counterparty: string, amount: number, bookedAt: string, reference: string): BankPayment => ({
    id, counterparty, amountMinor: usd(amount), currency: "USD", bookedAt, reference, account: "USD account"
  });
  const legacyInvoices = [
    legacyInvoice("INV-2041", "Atlas Cloud", 1200, "2026-09-28", "2026-10-15"),
    legacyInvoice("INV-2042", "Northstar Analytics", 2480, "2026-09-30", "2026-10-16"),
    legacyInvoice("INV-2043", "Cedar Workspace", 89, "2026-10-01", "2026-10-18"),
    legacyInvoice("INV-2044", "Mercury Design", 750, "2026-10-02", "2026-10-18"),
    legacyInvoice("INV-2045", "Oceanic Studio", 640, "2026-10-03", "2026-10-19"),
    legacyInvoice("INV-2046", "Lakeview Hosting", 399, "2026-10-05", "2026-10-20")
  ];
  const legacyPayments = [
    legacyPayment("TXN-8101", "ATLAS CLOUD INC", 1200, "2026-10-13", "INV-2041 / monthly cloud"),
    legacyPayment("TXN-8102", "Northstar Analytics LLC", 2840, "2026-10-14", "NORTHSTAR INV-2042"),
    legacyPayment("TXN-8103", "Mercury Design", 750, "2026-10-14", "INV-2044"),
    legacyPayment("TXN-8104", "Mercury Design", 750, "2026-10-15", "INV-2044 second transfer"),
    legacyPayment("TXN-8105", "OCEANIC STUDIO LLC", 640, "2026-10-14", "INV-2045 / design work"),
    legacyPayment("TXN-8106", "Lakeview Hosting", 399, "2026-10-15", "October hosting")
  ];
  const legacy = run(legacyInvoices, legacyPayments);

  it("finds matched, mismatched, missing, and duplicate cases", () => {
    expect(legacy.map((r) => r.status)).toEqual(["matched", "amount_mismatch", "missing_payment", "possible_duplicate", "matched", "matched"]);
  });

  it("calculates the amount mismatch deterministically", () => {
    expect(legacy[1].deltaMinor).toBe(36000);
    expect(legacy[1].matchedPayments[0].id).toBe("TXN-8102");
  });

  it("flags duplicate payments without treating them as a match", () => {
    expect(legacy[3].status).toBe("possible_duplicate");
    expect(legacy[3].matchedPayments).toHaveLength(2);
    expect(legacy[3].matchedPayments.reduce((sum, p) => sum + p.amountMinor, 0)).toBe(150000);
  });
});

describe("one payment settles at most one invoice", () => {
  it("does not let one generic transfer match two same-vendor invoices with the same gross", () => {
    const [a, b] = run(
      [invoice({ id: "INV-3001", number: "FV/1" }), invoice({ id: "INV-3002", number: "FV/2" })],
      [payment({ id: "P1", amountMinor: 123000, reference: "monthly fee" })]
    );
    for (const r of [a, b]) {
      expect(r.status).toBe("needs_review");
      expect(r.reviewReasons.map((x) => x.code)).toContain("shared_payment");
      expect(r.matchedPayments).toEqual([]);
      expect(r.due.state).not.toBe("settled");
    }
  });

  it("still matches when each invoice has its own exact payment", () => {
    const [a, b] = run(
      [invoice({ id: "INV-3001", number: "FV/2026/001" }), invoice({ id: "INV-3002", number: "FV/2026/002" })],
      [payment({ id: "P1", amountMinor: 123000, reference: "FV/2026/001" }), payment({ id: "P2", amountMinor: 123000, reference: "FV/2026/002" })]
    );
    expect([a.status, b.status]).toEqual(["matched", "matched"]);
    expect(a.matchedPayments.map((p) => p.id)).toEqual(["P1"]);
    expect(b.matchedPayments.map((p) => p.id)).toEqual(["P2"]);
  });

  it("does not reuse another invoice's exact payment as a partial-payment candidate", () => {
    const [a, b] = run(
      [invoice({ id: "INV-3001", number: "FV/1" }), invoice({ id: "INV-3002", number: "FV/2", netMinor: 50000, vatMinor: 11500, grossMinor: 61500 })],
      [payment({ id: "P1", amountMinor: 123000, reference: "monthly fee" })]
    );
    expect(a.status).toBe("matched");
    expect(b.status).toBe("missing_payment");
    expect(b.matchedPayments).toEqual([]);
  });
});

describe("invalid invoice data always wins over a matching payment", () => {
  it.each([
    ["invalid NIP", { vendorNip: "0000000018" }, "invalid_nip"],
    ["missing NIP for a Polish vendor", { vendorNip: null }, "missing_nip"],
    ["due before issue", { issuedAt: "2026-10-10", dueAt: "2026-10-01" }, "due_before_issue"],
    ["impossible date", { dueAt: "2026-02-30" }, "invalid_date"],
    ["net + VAT ≠ gross", { grossMinor: 123002 }, "vat_sum_mismatch"],
    ["VAT does not match the rate", { vatRate: "8" as const }, "vat_rate_mismatch"],
    ["unknown VAT rate", { vatRate: "17" as never }, "invalid_vat_rate"]
  ])("%s", (_label, overrides, code) => {
    const inv = invoice({ id: "INV-3101", ...overrides });
    const r = one(inv, [payment({ id: "P1", amountMinor: inv.grossMinor })]);
    expect(r.status).toBe("needs_review");
    expect(r.reviewReasons.map((x) => x.code)).toContain(code);
  });

  it("detects duplicate invoice numbers even when the NIP is formatted differently", () => {
    const r = run(
      [invoice({ id: "INV-3201", number: "FV/9", vendorNip: "0000000017" }), invoice({ id: "INV-3202", number: "FV/9", vendorNip: "PL 000-000-00-17" })],
      []
    );
    for (const x of r) expect(x.reviewReasons.map((y) => y.code)).toContain("duplicate_invoice_number");
  });
});

describe("currencies", () => {
  it("never matches an equal amount in a different currency", () => {
    const r = one(invoice({ id: "INV-3301", currency: "EUR", vatMinor: 0, netMinor: 4900, grossMinor: 4900, vatRate: "np", vendorCountry: "IE", vendorNip: null }), [
      payment({ id: "PLN", amountMinor: 4900, currency: "PLN" })
    ]);
    expect(r.status).toBe("needs_review");
    expect(r.matchedPayments).toEqual([]);
    expect(r.crossCurrencyPayments.map((p) => p.id)).toEqual(["PLN"]);
  });
});
