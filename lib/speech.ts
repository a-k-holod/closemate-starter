import type { PrismTraceEvent, TraceOutcome } from "./prism";
import { checkRateLimit, type RateLimitStore } from "./rate-limit";
import { demoExplanation, type ReconciliationResult } from "./reconcile";
import type { Locale } from "./locale";
import { parseLocale } from "./locale";
import { messagesFor } from "./messages";

export const SPEECH_MODEL = "eleven_multilingual_v2";
export const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

/** Built on the server from the deterministic summary, so the endpoint cannot be used to voice arbitrary text. */
export function speechTextFor(result: ReconciliationResult, locale: Locale = "en"): string {
  const summary = demoExplanation(result, locale);
  return locale === "pl" ? `Faktura ${result.invoice.number}. ${summary}` : `Invoice ${result.invoice.number}. ${summary}`;
}

export type SpeechDeps = {
  apiKey: string | undefined;
  voiceId: string;
  rateLimitStore: RateLimitStore | null;
  trace: (event: PrismTraceEvent) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type SpeechOutcome =
  | { kind: "audio"; audio: ArrayBuffer }
  | { kind: "error"; status: number; error: string; retryAfterSeconds?: number };

export async function synthesizeSpeech(input: { result: ReconciliationResult; sessionId: string; clientKey: string; locale?: unknown }, deps: SpeechDeps): Promise<SpeechOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const { result, sessionId, clientKey } = input;
  const locale = parseLocale(input.locale);
  const copy = messagesFor(locale).api;
  if (!deps.apiKey) return { kind: "error", status: 503, error: copy.voiceUnconfigured };

  const limit = await checkRateLimit(deps.rateLimitStore, "speak", clientKey, now);
  if (!limit.allowed) {
    if (limit.reason === "limited") return { kind: "error", status: 429, error: copy.voiceRateLimited, retryAfterSeconds: limit.retryAfterSeconds };
    return { kind: "error", status: 503, error: copy.voiceRateUnconfigured };
  }

  const trace = (outcome: TraceOutcome, extra: Partial<PrismTraceEvent["attributes"]> = {}) =>
    deps.trace({
      event: "speak.synthesis",
      agentId: "closemate-voice",
      sessionId,
      model: SPEECH_MODEL,
      latencyMs: now() - started,
      outcome,
      attributes: { invoiceRef: result.invoice.id, reconciliationStatus: result.status, reviewReasonCodes: result.reviewReasons.map((r) => r.code), locale, ...extra }
    });

  try {
    const upstream = await (deps.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(deps.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": deps.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: speechTextFor(result, locale), model_id: SPEECH_MODEL }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store"
    });
    if (!upstream.ok) {
      console.error(`ElevenLabs returned HTTP ${upstream.status}.`);
      trace("provider_error", { providerStatus: upstream.status });
      return { kind: "error", status: 502, error: copy.voiceProvider };
    }
    const audio = await upstream.arrayBuffer();
    trace("audio_ok", { audioBytes: audio.byteLength });
    return { kind: "audio", audio };
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`);
    console.error(`ElevenLabs request failed (${timeout ? "timeout" : error instanceof Error ? error.name : "unknown"}).`);
    trace(timeout ? "provider_timeout" : "provider_error");
    return { kind: "error", status: 502, error: copy.voiceFailed };
  }
}
