import { describe, expect, it, vi } from "vitest";
import { analyzeInvoice, buildModelInput, HUMAN_REVIEW_NOTICE, screenModelOutput, SYSTEM_PROMPT, type AnalyzeDeps, type ModelCompletion } from "../lib/ai-explanation";
import type { PrismTraceEvent } from "../lib/prism";
import { createMemoryStore } from "../lib/rate-limit";
import { demoExplanation, payments, results } from "../lib/reconcile";

const byId = (id: string) => results.find((r) => r.invoice.id === id)!;

/** Every free-text value from the demo records that could identify a real business or account in production. */
function sensitiveStrings(): string[] {
  const values = new Set<string>();
  for (const { invoice } of results) {
    values.add(invoice.vendor);
    values.add(invoice.number);
    if (invoice.vendorNip) values.add(invoice.vendorNip);
  }
  for (const p of payments) {
    values.add(p.counterparty);
    values.add(p.reference);
    values.add(p.account);
  }
  return [...values];
}

function deps(overrides: Partial<AnalyzeDeps> & { traces?: PrismTraceEvent[] } = {}): AnalyzeDeps {
  const traces = overrides.traces ?? [];
  return {
    complete: null,
    model: "nicrron/auto",
    rateLimitStore: createMemoryStore(),
    traceConfigured: true,
    trace: (event) => traces.push(event),
    ...overrides
  };
}

const run = (id: string, d: AnalyzeDeps) => analyzeInvoice({ result: byId(id), sessionId: "s-1", clientKey: "client" }, d);

describe("approved model data flow", () => {
  it.each(results.map((r) => r.invoice.id))("sends no vendor names, NIP, invoice numbers, bank references or account names for %s", (id) => {
    const serialized = JSON.stringify(buildModelInput(byId(id)));
    for (const value of sensitiveStrings()) expect(serialized).not.toContain(value);
    expect(serialized).not.toMatch(/000-?000-?00/);
  });

  it("keeps deterministic amounts as pre-formatted strings", () => {
    const input = buildModelInput(byId("INV-2102"));
    expect(input.invoice.gross).toBe("PLN 738.00");
    expect(input.reconciliation.linkedPaymentsTotalMinusGross).toBe("-PLN 138.00");
    expect(input.reconciliation.linkedPaymentEqualsNet).toBe(true);
    expect(input.bankEvidenceSameCurrency).toEqual([{ id: "TXN-9102", bookedAt: "2026-10-14", amount: "PLN 600.00" }]);
  });

  it("keeps other-currency evidence separate and labelled as not matched", () => {
    const input = buildModelInput(byId("INV-2109"));
    expect(input.bankEvidenceSameCurrency).toEqual([]);
    expect(input.bankEvidenceOtherCurrencyNotMatched.map((p) => p.amount)).toEqual(["PLN 81.42"]);
  });

  it("instructs the model to separate evidence from hypotheses and keep humans in control", () => {
    expect(SYSTEM_PROMPT).toMatch(/known evidence/);
    expect(SYSTEM_PROMPT).toMatch(/possible explanation/);
    expect(SYSTEM_PROMPT).toMatch(/cannot move money/);
    expect(SYSTEM_PROMPT).toMatch(/person reviews the item/);
  });
});

describe("output guardrail", () => {
  it.each([
    ["I have transferred the missing PLN 138.00 to the vendor.", "agent_action_claim"],
    ["CloseMate refunded the duplicate payment.", "agent_action_claim"],
    ["The ledger has been updated to reflect the payment.", "ledger_change_claim"],
    ["A refund has been issued for TXN-9104.", "refund_claim"],
    ["This expense is fully deductible.", "tax_determination"],
    ["We submitted it to KSeF.", "external_system_claim"]
  ])("blocks %j", (text, flag) => {
    const result = screenModelOutput(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.flags).toContain(flag);
  });

  it.each([
    "No payment or refund has been initiated.",
    "CloseMate has not changed the ledger and cannot transfer money.",
    "Evidence: TXN-9102 for PLN 600.00 was booked on 2026-10-14. Possibly the VAT portion is unpaid. A person should review this before acting.",
    "Whether the VAT is deductible should be confirmed with your accountant."
  ])("allows %j", (text) => {
    expect(screenModelOutput(text)).toEqual({ ok: true });
  });

  it("blocks overlong output", () => {
    expect(screenModelOutput("a ".repeat(700))).toEqual({ ok: false, flags: ["too_long"] });
  });
});

describe("analyzeInvoice", () => {
  it("never calls a paid API when no key is configured and returns the deterministic explanation", async () => {
    const traces: PrismTraceEvent[] = [];
    const out = await run("INV-2102", deps({ traces }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ mode: "rules", fallbackReason: "no_api_key", explanation: demoExplanation(byId("INV-2102")), model: null });
    expect(traces.map((t) => t.outcome)).toEqual(["rules_no_api_key"]);
  });

  it("does not call the model when rate limiting is not configured (production fail-closed)", async () => {
    const complete = vi.fn<ModelCompletion>();
    const out = await run("INV-2102", deps({ complete, rateLimitStore: null }));
    expect(complete).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ mode: "rules", fallbackReason: "rate_limit_unconfigured" });
  });

  it("returns 429 with the deterministic explanation once the client exceeds its limit", async () => {
    const complete = vi.fn<ModelCompletion>(async () => "Evidence: amounts differ. A person should review this.");
    const d = deps({ complete, rateLimitStore: createMemoryStore(() => 0), now: () => 0 });
    let out;
    for (let i = 0; i < 11; i++) out = await run("INV-2102", d);
    expect(complete).toHaveBeenCalledTimes(10);
    expect(out!.status).toBe(429);
    expect(out!.retryAfterSeconds).toBeGreaterThan(0);
    expect(out!.body).toMatchObject({ mode: "rules", fallbackReason: "rate_limited", explanation: demoExplanation(byId("INV-2102")) });
  });

  it("returns the model text and appends a human-review notice when it is missing", async () => {
    const traces: PrismTraceEvent[] = [];
    const out = await run("INV-2105", deps({ traces, complete: async () => "No bank payment is linked to this invoice, which is 13 days overdue." }));
    expect(out.body.mode).toBe("nicrron");
    expect(out.body.explanation.endsWith(HUMAN_REVIEW_NOTICE)).toBe(true);
    expect(traces[0].outcome).toBe("model_ok_appended_review_notice");
  });

  it("falls back without inventing evidence when the provider fails", async () => {
    const traces: PrismTraceEvent[] = [];
    const error = Object.assign(new Error("401 Incorrect API key provided: sk-live-123"), { status: 401 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await run("INV-2104", deps({ traces, complete: async () => { throw error; } }));
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ mode: "rules", fallbackReason: "provider_error", explanation: demoExplanation(byId("INV-2104")) });
    expect(JSON.stringify(out.body)).not.toContain("sk-live");
    expect(JSON.stringify(traces)).not.toContain("sk-live");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("sk-live");
    expect(traces[0]).toMatchObject({ outcome: "provider_error_fallback", attributes: { providerStatus: 401 } });
    spy.mockRestore();
  });

  it("classifies timeouts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await run("INV-2104", deps({ complete: async () => { throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }); } }));
    expect(out.body.fallbackReason).toBe("provider_timeout");
    vi.restoreAllMocks();
  });

  it("replaces unsupported claims and empty output with the deterministic explanation", async () => {
    const blocked = await run("INV-2104", deps({ complete: async () => "I have refunded the duplicate transfer." }));
    expect(blocked.body).toMatchObject({ mode: "rules", fallbackReason: "guardrail_blocked", explanation: demoExplanation(byId("INV-2104")) });
    const empty = await run("INV-2104", deps({ complete: async () => "   " }));
    expect(empty.body.fallbackReason).toBe("empty_output");
  });

  it("sends only the minimised record to the model", async () => {
    const complete = vi.fn<ModelCompletion>(async () => "Matched. Keep TXN-9101 as evidence.");
    await run("INV-2101", deps({ complete }));
    const { user, system } = complete.mock.calls[0][0];
    expect(system).toBe(SYSTEM_PROMPT);
    for (const value of sensitiveStrings()) expect(user).not.toContain(value);
  });
});
