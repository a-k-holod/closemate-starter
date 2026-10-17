import { describe, expect, it } from "vitest";
import type { BankPayment, Invoice } from "../lib/invoice";
import {
  countByFilter,
  countReviewQueue,
  filterResults,
  foldSearchText,
  matchesFilter,
  matchesSearch,
  REVIEW_FILTERS,
  reviewQueueState,
  summarizeByCurrency,
  type ReviewDecisions
} from "../lib/invoice-review";
import { reconcile, results } from "../lib/reconcile";

const AS_OF = "2026-10-17";
const none: ReviewDecisions = {};
const ids = (rs: { invoice: { id: string } }[]) => rs.map((r) => r.invoice.id);

function invoice(overrides: Partial<Invoice> & Pick<Invoice, "id">): Invoice {
  return {
    number: `FV/${overrides.id}`,
    vendor: "Test Vendor sp. z o.o.",
    vendorCountry: "PL",
    vendorNip: "0000000017",
    issuedAt: "2026-10-01",
    dueAt: "2026-10-20",
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
  return { counterparty: "unrelated", currency: "PLN", bookedAt: "2026-10-10", reference: "transfer", account: "PLN business account", ...overrides };
}

describe("search", () => {
  const byId = (id: string) => results.find((r) => r.invoice.id === id)!;

  it("matches everything for an empty or whitespace query", () => {
    expect(filterResults(results, "", "all", none)).toHaveLength(results.length);
    expect(filterResults(results, "   ", "all", none)).toHaveLength(results.length);
  });

  it("finds invoices by internal ID and by vendor invoice number, ignoring case and punctuation", () => {
    expect(ids(filterResults(results, "inv-2109", "all", none))).toEqual(["INV-2109"]);
    expect(ids(filterResults(results, "FV/CW/2026/10/031", "all", none))).toEqual(["INV-2104"]);
    expect(ids(filterResults(results, "fv cw 2026 10 031", "all", none))).toEqual(["INV-2104"]);
    expect(ids(filterResults(results, "47/10", "all", none))).toEqual(["INV-2102"]);
  });

  it("finds vendors without typing Polish diacritics", () => {
    expect(foldSearchText("Kancelaria Demo Wiśniewska")).toBe("kancelariademowisniewska");
    expect(foldSearchText("Przykład")).toBe("przyklad");
    expect(ids(filterResults(results, "wisniewska", "all", none))).toEqual(["INV-2105"]);
    expect(ids(filterResults(results, "przyklad", "all", none))).toEqual(["INV-2102", "INV-2107"]);
    expect(ids(filterResults(results, "Sprzęt IT", "all", none))).toEqual(["INV-2108"]);
  });

  it("finds a vendor by NIP with dashes, spaces or a PL prefix", () => {
    for (const q of ["0000000069", "000-000-00-69", "000 000 00 69", "PL0000000069", "pl 000-000-00-69"]) {
      expect(ids(filterResults(results, q, "all", none)), q).toEqual(["INV-2105"]);
    }
  });

  it("does not match foreign vendors that have no NIP on a numeric query", () => {
    const foreign = byId("INV-2106");
    expect(foreign.invoice.vendorNip).toBeNull();
    expect(matchesSearch(foreign, "0000000")).toBe(false);
  });

  it("finds invoices by category label in English or Polish", () => {
    expect(ids(filterResults(results, "telecom", "all", none))).toEqual(["INV-2103"]);
    expect(ids(filterResults(results, "najem biura", "all", none))).toEqual(["INV-2104"]);
    expect(ids(filterResults(results, "software", "all", none))).toEqual(["INV-2106", "INV-2109"]);
  });

  it("returns nothing for a query that matches no field", () => {
    expect(filterResults(results, "zzz-no-such-vendor", "all", none)).toEqual([]);
  });
});

describe("status filters", () => {
  it("filters the demo data by reconciliation status and overdue state", () => {
    expect(ids(filterResults(results, "", "matched", none))).toEqual(["INV-2101", "INV-2106", "INV-2107"]);
    expect(ids(filterResults(results, "", "amount_mismatch", none))).toEqual(["INV-2102"]);
    expect(ids(filterResults(results, "", "missing_payment", none))).toEqual(["INV-2103", "INV-2105"]);
    expect(ids(filterResults(results, "", "possible_duplicate", none))).toEqual(["INV-2104"]);
    expect(ids(filterResults(results, "", "overdue", none))).toEqual(["INV-2102", "INV-2105", "INV-2109"]);
  });

  it("puts every exception or overdue item in the review queue until a reviewer signs it off", () => {
    expect(ids(filterResults(results, "", "needs_review", none))).toEqual(["INV-2102", "INV-2103", "INV-2104", "INV-2105", "INV-2108", "INV-2109"]);
  });

  it("removes reviewed records from the queue and adds records a reviewer flags", () => {
    const decisions: ReviewDecisions = { "INV-2102": "reviewed", "INV-2101": "needs_review" };
    expect(ids(filterResults(results, "", "needs_review", decisions))).toEqual(["INV-2101", "INV-2103", "INV-2104", "INV-2105", "INV-2108", "INV-2109"]);
  });

  it("treats any overdue record as needing review, whatever its status", () => {
    const [paidLate] = reconcile([invoice({ id: "LATE", dueAt: "2026-10-01" })], [payment({ id: "P", amountMinor: 123000, reference: "FV/LATE" })], { asOf: AS_OF });
    expect(paidLate.status).toBe("matched");
    expect(matchesFilter(paidLate, "needs_review", none)).toBe(false);
    expect(matchesFilter({ ...paidLate, due: { state: "overdue", daysPastDue: 3 } }, "needs_review", none)).toBe(true);
  });

  it("does not let reviewer decisions change reconciliation-status filters", () => {
    const decisions: ReviewDecisions = { "INV-2102": "reviewed" };
    expect(ids(filterResults(results, "", "amount_mismatch", decisions))).toEqual(["INV-2102"]);
  });

  it("combines search and filter", () => {
    expect(ids(filterResults(results, "demo", "missing_payment", none))).toEqual(["INV-2103", "INV-2105"]);
    expect(ids(filterResults(results, "przyklad", "matched", none))).toEqual(["INV-2107"]);
    expect(filterResults(results, "przyklad", "possible_duplicate", none)).toEqual([]);
  });
});

describe("filter counts", () => {
  it("counts the demo data accurately", () => {
    expect(countByFilter(results, "", none)).toEqual({
      all: 9,
      matched: 3,
      amount_mismatch: 1,
      missing_payment: 2,
      possible_duplicate: 1,
      overdue: 3,
      needs_review: 6
    });
  });

  it("counts only records matching the current search", () => {
    const counts = countByFilter(results, "demo", none);
    expect(counts.all).toBe(8);
    expect(counts.amount_mismatch).toBe(0);
    expect(counts.matched).toBe(3);
  });

  it("always agrees with the filtered list length", () => {
    const decisions: ReviewDecisions = { "INV-2104": "reviewed", "INV-2107": "needs_review" };
    for (const query of ["", "demo", "przyklad", "0000000", "software", "nothing-here"]) {
      const counts = countByFilter(results, query, decisions);
      for (const f of REVIEW_FILTERS) expect(counts[f], `${query}/${f}`).toBe(filterResults(results, query, f, decisions).length);
    }
  });

  it("reflects reviewer decisions in the needs-review count", () => {
    expect(countByFilter(results, "", { "INV-2102": "reviewed", "INV-2105": "reviewed" }).needs_review).toBe(4);
  });
});

describe("review queue state", () => {
  const [matched, mismatch] = reconcile(
    [invoice({ id: "MATCH" }), invoice({ id: "SHORT" })],
    [payment({ id: "P1", amountMinor: 123000, reference: "FV/MATCH" }), payment({ id: "P2", amountMinor: 100000, reference: "FV/SHORT" })],
    { asOf: AS_OF }
  );

  it("derives the default state from the reconciliation result", () => {
    expect(reviewQueueState(matched, undefined)).toBe("not_required");
    expect(reviewQueueState(mismatch, undefined)).toBe("awaiting");
  });

  it("lets an explicit reviewer decision win", () => {
    expect(reviewQueueState(mismatch, "reviewed")).toBe("reviewed");
    expect(reviewQueueState(matched, "needs_review")).toBe("flagged");
  });

  it("counts every record in exactly one queue state", () => {
    const counts = countReviewQueue(results, { "INV-2102": "reviewed", "INV-2101": "needs_review" });
    expect(counts).toEqual({ reviewed: 1, flagged: 1, awaiting: 5, not_required: 2 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(results.length);
  });
});

describe("summarizeByCurrency", () => {
  it("never combines currencies and lists them in PLN, EUR, USD order", () => {
    const summary = summarizeByCurrency(results);
    expect(summary.map((s) => s.currency)).toEqual(["PLN", "EUR", "USD"]);
    expect(summary).toEqual([
      { currency: "PLN", invoiceCount: 7, grossMinor: 657148, paidMinor: 594149, unpaidMinor: 210599, overpaidMinor: 147600 },
      { currency: "EUR", invoiceCount: 1, grossMinor: 4900, paidMinor: 4900, unpaidMinor: 0, overpaidMinor: 0 },
      { currency: "USD", invoiceCount: 1, grossMinor: 2000, paidMinor: 0, unpaidMinor: 2000, overpaidMinor: 0 }
    ]);
  });

  it("omits currencies that are not in the view", () => {
    expect(summarizeByCurrency(filterResults(results, "", "possible_duplicate", none)).map((s) => s.currency)).toEqual(["PLN"]);
    expect(summarizeByCurrency([])).toEqual([]);
  });

  it("keeps a duplicate overpayment from hiding another invoice's shortfall", () => {
    const rs = reconcile(
      [invoice({ id: "DUP" }), invoice({ id: "OPEN" })],
      [payment({ id: "P1", amountMinor: 123000, reference: "FV/DUP" }), payment({ id: "P2", amountMinor: 123000, reference: "FV/DUP again" })],
      { asOf: AS_OF }
    );
    expect(rs.map((r) => r.status)).toEqual(["possible_duplicate", "missing_payment"]);
    const [pln] = summarizeByCurrency(rs);
    expect(pln.paidMinor - pln.grossMinor).toBe(0);
    expect(pln.unpaidMinor).toBe(123000);
    expect(pln.overpaidMinor).toBe(123000);
  });

  it("sums fractional amounts exactly in minor units", () => {
    const rs = reconcile(
      Array.from({ length: 10 }, (_, i) => invoice({ id: `T${i}`, netMinor: 8, vatMinor: 2, grossMinor: 10, vatRate: "23" })),
      [],
      { asOf: AS_OF }
    );
    const [pln] = summarizeByCurrency(rs);
    expect(pln.grossMinor).toBe(100);
  });

  it("keeps a USD invoice's PLN card payment out of the USD totals", () => {
    const usd = summarizeByCurrency(results).find((s) => s.currency === "USD")!;
    expect(usd.paidMinor).toBe(0);
  });
});
