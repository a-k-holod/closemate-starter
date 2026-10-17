import { describe, expect, it } from "vitest";
import { invoices, payments, reconcile } from "../lib/reconcile";

describe("reconcile demo data", () => {
  it("finds matched, mismatched, missing, and duplicate cases", () => {
    const statuses = reconcile(invoices, payments).map((r) => r.status);
    expect(statuses).toEqual(["matched", "amount_mismatch", "missing_payment", "possible_duplicate", "matched", "matched"]);
  });

  it("calculates the amount mismatch deterministically", () => {
    const result = reconcile(invoices, payments)[1];
    expect(result.delta).toBe(360);
    expect(result.matchedPayments[0].id).toBe("TXN-8102");
  });

  it("flags duplicate payments without treating them as a match", () => {
    const result = reconcile(invoices, payments)[3];
    expect(result.status).toBe("possible_duplicate");
    expect(result.matchedPayments).toHaveLength(2);
    expect(result.matchedPayments.reduce((sum, p) => sum + p.amount, 0)).toBe(1500);
  });
});
