import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeInvoice } from "../lib/ai-explanation";
import { buildPrismTraceBody, emitPrismTrace, type PrismTraceEvent } from "../lib/prism";
import { createMemoryStore } from "../lib/rate-limit";
import { payments, results } from "../lib/reconcile";
import { speechTextFor, synthesizeSpeech } from "../lib/speech";

const SENSITIVE: string[] = [
  ...results.flatMap(({ invoice }) => [invoice.vendor, invoice.number, invoice.vendorNip ?? ""]).filter(Boolean),
  ...payments.flatMap((p) => [p.counterparty, p.reference, p.account])
];
const REVIEWER_NOTE = "Prywatna notatka: zadzwonić do księgowej";

afterEach(() => vi.restoreAllMocks());

async function tracesForEveryInvoice(): Promise<PrismTraceEvent[]> {
  const traces: PrismTraceEvent[] = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const outputs = [
    async () => `Evidence for ${"Chmura Demo sp. z o.o."}: FV/2026/09/118. A person should review this.`,
    async () => { throw new Error(`upstream echoed ${REVIEWER_NOTE} and sk-secret`); },
    async () => "I have transferred the money."
  ];
  for (const result of results) {
    for (const complete of outputs) {
      await analyzeInvoice({ result, sessionId: "closemate-demo-1", clientKey: "c" }, {
        complete, model: "nicrron/auto", rateLimitStore: createMemoryStore(), traceConfigured: true, trace: (e) => traces.push(e)
      });
    }
  }
  return traces;
}

describe("PRISM trace privacy", () => {
  it("never contains vendor names, NIP, invoice numbers, bank references, notes, prompts or model text", async () => {
    const traces = await tracesForEveryInvoice();
    expect(traces.length).toBe(results.length * 3);
    const serialized = JSON.stringify(traces.map((t) => buildPrismTraceBody("project", t)));
    for (const value of SENSITIVE) expect(serialized).not.toContain(value);
    for (const forbidden of [REVIEWER_NOTE, "sk-secret", "You are CloseMate", "transferred the money", "Evidence for"]) expect(serialized).not.toContain(forbidden);
  });

  it("records safe identifiers, outcome categories, latency and model metadata", () => {
    const body = buildPrismTraceBody("project-1", {
      event: "analyze.explanation", agentId: "closemate-reconciliation", sessionId: "s", model: "nicrron/auto", latencyMs: 12.6,
      outcome: "guardrail_fallback", attributes: { invoiceRef: "INV-2104", reconciliationStatus: "possible_duplicate", reviewReasonCodes: [], outputChars: 40, guardrailFlags: ["refund_claim"] }
    });
    expect(body).toMatchObject({ project_id: "project-1", model: "nicrron/auto", latency_ms: 13, session_id: "s", agent_id: "closemate-reconciliation" });
    expect(JSON.parse(body.input_messages[0].content)).toEqual({ event: "analyze.explanation", invoiceRef: "INV-2104", reconciliationStatus: "possible_duplicate", reviewReasonCodes: [] });
    expect(JSON.parse(body.output_message)).toEqual({ outcome: "guardrail_fallback", outputChars: 40, guardrailFlags: ["refund_claim"] });
  });
});

describe("PRISM delivery never breaks the workflow", () => {
  const event: PrismTraceEvent = {
    event: "analyze.explanation", agentId: "closemate-reconciliation", sessionId: "s", model: "m", latencyMs: 1,
    outcome: "model_ok", attributes: { invoiceRef: "INV-2101", reconciliationStatus: "matched", reviewReasonCodes: [] }
  };
  const env = { PRISMTRACE_PROJECT_ID: "p", PRISMTRACE_API_KEY: "prism-key", PRISMTRACE_HOST: "https://prism.example/" };

  it("does nothing without credentials", async () => {
    const fetchImpl = vi.fn();
    await emitPrismTrace(event, {}, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the key only as a header, never in the body", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await emitPrismTrace(event, env, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://prism.example/api/traces");
    expect((init.headers as Record<string, string>)["X-PRISMtrace-Key"]).toBe("prism-key");
    expect(init.body as string).not.toContain("prism-key");
  });

  it("swallows network errors and HTTP failures without logging error details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(emitPrismTrace(event, env, (async () => { throw new TypeError("fetch failed: secret-host-detail"); }) as unknown as typeof fetch)).resolves.toBeUndefined();
    await expect(emitPrismTrace(event, env, (async () => new Response("down", { status: 503 })) as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-host-detail");
  });
});

describe("speech endpoint service", () => {
  const result = results.find((r) => r.invoice.id === "INV-2105")!;
  const base = { voiceId: "voice", rateLimitStore: createMemoryStore(), trace: () => undefined };

  it("returns 503 without calling ElevenLabs when no key is configured", async () => {
    const fetchImpl = vi.fn();
    const out = await synthesizeSpeech({ result, sessionId: "s", clientKey: "c" }, { ...base, apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatchObject({ kind: "error", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses paid calls when rate limiting is not configured", async () => {
    const fetchImpl = vi.fn();
    const out = await synthesizeSpeech({ result, sessionId: "s", clientKey: "c" }, { ...base, rateLimitStore: null, apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatchObject({ kind: "error", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("voices only server-built text for a known invoice", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const traces: PrismTraceEvent[] = [];
    const out = await synthesizeSpeech({ result, sessionId: "s", clientKey: "c" }, { ...base, apiKey: "k", trace: (e) => traces.push(e), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.kind).toBe("audio");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).text).toBe(speechTextFor(result));
    expect(traces[0]).toMatchObject({ outcome: "audio_ok", attributes: { invoiceRef: "INV-2105", audioBytes: 3 } });
    expect(JSON.stringify(traces)).not.toContain(result.invoice.vendor);
  });

  it("does not echo provider error bodies to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = async () => new Response("quota exceeded for account angela@example.com", { status: 401 });
    const out = await synthesizeSpeech({ result, sessionId: "s", clientKey: "c" }, { ...base, apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatchObject({ kind: "error", status: 502 });
    expect(JSON.stringify(out)).not.toContain("angela@");
  });
});
