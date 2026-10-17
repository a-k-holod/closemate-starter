import { describe, expect, it } from "vitest";
import { checkVatSum, daysBetween, expectedVat, formatNip, isIsoDate, isValidNip, validateInvoice, VAT_ROUNDING_TOLERANCE_MINOR, type Invoice } from "../lib/invoice";

const base: Invoice = {
  id: "INV-T1",
  number: "FV/TEST/1",
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
  category: "software"
};
const codes = (invoice: Invoice, tolerance?: number) => validateInvoice(invoice, tolerance).map((i) => i.code);

describe("NIP validation", () => {
  it("accepts checksum-valid NIPs in common formats", () => {
    expect(isValidNip("0000000017")).toBe(true);
    expect(isValidNip("000-000-00-17")).toBe(true);
    expect(isValidNip("PL0000000023")).toBe(true);
    expect(isValidNip("1234563218")).toBe(true);
  });

  it("rejects bad checksums and malformed values", () => {
    expect(isValidNip("0000000018")).toBe(false);
    expect(isValidNip("1234563219")).toBe(false);
    expect(isValidNip("123456321")).toBe(false);
    expect(isValidNip("ABCDEFGHIJ")).toBe(false);
  });

  it("formats NIPs in the conventional groups", () => {
    expect(formatNip("0000000017")).toBe("000-000-00-17");
  });
});

describe("VAT consistency", () => {
  it("uses an explicit 1 minor-unit tolerance", () => {
    expect(VAT_ROUNDING_TOLERANCE_MINOR).toBe(1);
  });

  it("accepts net + VAT equal to gross", () => {
    expect(checkVatSum(base)).toEqual({ differenceMinor: 0, withinTolerance: true });
    expect(codes(base)).toEqual([]);
  });

  it("accepts a 1 grosz rounding gap in either direction", () => {
    expect(checkVatSum({ ...base, grossMinor: 123001 }).withinTolerance).toBe(true);
    expect(checkVatSum({ ...base, grossMinor: 122999 }).withinTolerance).toBe(true);
    expect(codes({ ...base, grossMinor: 123001 })).toEqual([]);
  });

  it("flags gaps beyond the tolerance", () => {
    expect(checkVatSum({ ...base, grossMinor: 123002 })).toEqual({ differenceMinor: -2, withinTolerance: false });
    expect(codes({ ...base, grossMinor: 123200 })).toEqual(["vat_sum_mismatch"]);
    expect(validateInvoice({ ...base, grossMinor: 123200 })[0].message).toBe(
      "Net + VAT (PLN 1,230.00) differs from gross (PLN 1,232.00) by PLN 2.00, above the PLN 0.01 rounding tolerance."
    );
  });

  it("honours a caller-supplied tolerance", () => {
    expect(codes({ ...base, grossMinor: 123002 }, 2)).toEqual([]);
    expect(codes({ ...base, grossMinor: 123001 }, 0)).toEqual(["vat_sum_mismatch"]);
  });

  it("checks VAT against the stated single rate with half-up rounding", () => {
    expect(expectedVat(24999, "23")).toBe(5750);
    expect(codes({ ...base, netMinor: 24999, vatMinor: 5750, grossMinor: 30749 })).toEqual([]);
    expect(codes({ ...base, netMinor: 24999, vatMinor: 5749, grossMinor: 30748 })).toEqual([]);
    expect(codes({ ...base, vatMinor: 8000, grossMinor: 108000 })).toEqual(["vat_rate_mismatch"]);
    expect(codes({ ...base, vatRate: "8", vatMinor: 8000, grossMinor: 108000 })).toEqual([]);
  });

  it("requires zero VAT on exempt, 0% and not-subject documents", () => {
    for (const vatRate of ["zw", "np", "0"] as const) {
      expect(codes({ ...base, vatRate, vatMinor: 0, grossMinor: 100000 })).toEqual([]);
      expect(codes({ ...base, vatRate, vatMinor: 23000, grossMinor: 123000 })).toEqual(["vat_rate_mismatch"]);
    }
  });

  it("rejects fractional minor units and non-positive gross", () => {
    expect(codes({ ...base, netMinor: 1000.5 })).toContain("invalid_amount");
    expect(codes({ ...base, netMinor: 0, vatMinor: 0, grossMinor: 0 })).toContain("non_positive_amount");
    expect(codes({ ...base, netMinor: -100000, vatMinor: -23000, grossMinor: -123000 })).toContain("non_positive_amount");
  });
});

describe("vendor identity and currency", () => {
  it("requires a valid NIP for Polish vendors only", () => {
    expect(codes({ ...base, vendorNip: null })).toEqual(["missing_nip"]);
    expect(codes({ ...base, vendorNip: "0000000018" })).toEqual(["invalid_nip"]);
    expect(codes({ ...base, vendorCountry: "IE", vendorNip: null, vatRate: "np", vatMinor: 0, grossMinor: 100000 })).toEqual([]);
  });

  it("rejects unsupported currencies", () => {
    expect(codes({ ...base, currency: "GBP" as Invoice["currency"] })).toContain("unsupported_currency");
  });
});

describe("dates", () => {
  it("validates strict calendar dates", () => {
    expect(isIsoDate("2026-10-17")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("17.10.2026")).toBe(false);
  });

  it("counts calendar days independent of timezone and DST", () => {
    expect(daysBetween("2026-10-04", "2026-10-17")).toBe(13);
    expect(daysBetween("2026-10-17", "2026-10-17")).toBe(0);
    expect(daysBetween("2026-10-22", "2026-10-17")).toBe(-5);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("flags invalid dates and due dates before the issue date", () => {
    expect(codes({ ...base, dueAt: "2026-09-30" })).toEqual(["due_before_issue"]);
    expect(codes({ ...base, issuedAt: "2026-02-30" })).toEqual(["invalid_date"]);
    expect(codes({ ...base, dueAt: base.issuedAt })).toEqual([]);
  });
});
