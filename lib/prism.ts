import type { Locale } from "./locale";
import type { ReconciliationStatus, ReviewReasonCode } from "./reconcile";

/**
 * Privacy-safe trace payload. Only internal IDs, enums, counts and timings are allowed:
 * no vendor names, NIP, bank references, reviewer notes, prompts, model output text or credentials.
 */
export type PrismTraceEvent = {
  event: "analyze.explanation" | "speak.synthesis";
  agentId: "closemate-reconciliation" | "closemate-voice";
  sessionId: string;
  model: string;
  latencyMs: number;
  outcome: TraceOutcome;
  attributes: {
    invoiceRef: string;
    reconciliationStatus: ReconciliationStatus;
    reviewReasonCodes: readonly ReviewReasonCode[];
    /** UI language for this request. A code only — never a prompt or model sentence. */
    locale?: Locale;
    outputChars?: number;
    audioBytes?: number;
    guardrailFlags?: readonly string[];
    providerStatus?: number;
  };
};

export type TraceOutcome =
  | "model_ok"
  | "model_ok_appended_review_notice"
  | "guardrail_fallback"
  | "empty_output_fallback"
  | "provider_error_fallback"
  | "provider_timeout_fallback"
  | "rules_no_api_key"
  | "audio_ok"
  | "provider_error"
  | "provider_timeout";

export type PrismTraceBody = {
  project_id: string;
  model: string;
  input_messages: { role: "user"; content: string }[];
  output_message: string;
  latency_ms: number;
  session_id: string;
  agent_id: string;
};

export function buildPrismTraceBody(projectId: string, event: PrismTraceEvent): PrismTraceBody {
  const { attributes } = event;
  return {
    project_id: projectId,
    model: event.model,
    input_messages: [{
      role: "user",
      content: JSON.stringify({
        event: event.event,
        invoiceRef: attributes.invoiceRef,
        reconciliationStatus: attributes.reconciliationStatus,
        reviewReasonCodes: attributes.reviewReasonCodes,
        ...(attributes.locale ? { locale: attributes.locale } : {})
      })
    }],
    output_message: JSON.stringify({
      outcome: event.outcome,
      ...(attributes.outputChars !== undefined ? { outputChars: attributes.outputChars } : {}),
      ...(attributes.audioBytes !== undefined ? { audioBytes: attributes.audioBytes } : {}),
      ...(attributes.guardrailFlags?.length ? { guardrailFlags: attributes.guardrailFlags } : {}),
      ...(attributes.providerStatus !== undefined ? { providerStatus: attributes.providerStatus } : {})
    }),
    latency_ms: Math.max(0, Math.round(event.latencyMs)),
    session_id: event.sessionId,
    agent_id: event.agentId
  };
}

export function isPrismConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.PRISMTRACE_PROJECT_ID && env.PRISMTRACE_API_KEY);
}

/** Send a trace to PRISM over its documented HTTP API. Never throws: observability must not break the workflow. */
export async function emitPrismTrace(
  event: PrismTraceEvent,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const host = env.PRISMTRACE_HOST || "https://api.prism.blockconvey.com";
  const projectId = env.PRISMTRACE_PROJECT_ID;
  const apiKey = env.PRISMTRACE_API_KEY;
  if (!projectId || !apiKey) return;

  try {
    const response = await fetchImpl(`${host.replace(/\/$/, "")}/api/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRISMtrace-Key": apiKey },
      body: JSON.stringify(buildPrismTraceBody(projectId, event)),
      signal: AbortSignal.timeout(5000),
      cache: "no-store"
    });
    if (!response.ok) console.warn(`PRISM trace delivery returned HTTP ${response.status}; continuing.`);
  } catch (error) {
    console.warn(`PRISM trace delivery failed (${error instanceof Error ? error.name : "unknown error"}); continuing.`);
  }
}
