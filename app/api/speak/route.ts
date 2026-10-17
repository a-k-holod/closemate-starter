import { after } from "next/server";
import { clientKey, jsonResponse, noStoreHeaders, parseInvoiceRequest, readJsonObject, RequestError } from "@/lib/http";
import { emitPrismTrace, type PrismTraceEvent } from "@/lib/prism";
import { resolveRateLimitStore } from "@/lib/rate-limit";
import { DEFAULT_VOICE_ID, synthesizeSpeech } from "@/lib/speech";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = parseInvoiceRequest(await readJsonObject(request), "closemate-voice");
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: "Invalid request." }, { status: 400 });
  }

  const traces: PrismTraceEvent[] = [];
  const outcome = await synthesizeSpeech(
    { ...parsed, clientKey: clientKey(request) },
    {
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
      rateLimitStore: resolveRateLimitStore(),
      trace: (event) => traces.push(event)
    }
  );
  if (traces.length) after(() => Promise.all(traces.map((event) => emitPrismTrace(event))));

  if (outcome.kind === "error") {
    return jsonResponse({ error: outcome.error }, {
      status: outcome.status,
      headers: outcome.retryAfterSeconds ? { "Retry-After": String(outcome.retryAfterSeconds) } : {}
    });
  }
  return new Response(outcome.audio, { headers: noStoreHeaders({ "Content-Type": "audio/mpeg" }) });
}
