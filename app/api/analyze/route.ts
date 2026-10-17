import OpenAI from "openai";
import { after } from "next/server";
import { analyzeInvoice, type ModelCompletion } from "@/lib/ai-explanation";
import { clientKey, jsonResponse, parseInvoiceRequest, readJsonObject, RequestError } from "@/lib/http";
import { emitPrismTrace, isPrismConfigured, type PrismTraceEvent } from "@/lib/prism";
import { resolveRateLimitStore } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const NICRRON_BASE_URL = "https://api.nicrron.ai/v1";

function nicrronCompletion(apiKey: string): ModelCompletion {
  const client = new OpenAI({ apiKey, baseURL: NICRRON_BASE_URL, timeout: 20_000, maxRetries: 0 });
  return async ({ model, system, user }) => {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    return completion.choices[0]?.message?.content;
  };
}

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = parseInvoiceRequest(await readJsonObject(request), "closemate-analyze");
  } catch (error) {
    if (error instanceof RequestError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: "Invalid request." }, { status: 400 });
  }

  const apiKey = process.env.NICRRON_API_KEY;
  const traces: PrismTraceEvent[] = [];
  const outcome = await analyzeInvoice(
    { ...parsed, clientKey: clientKey(request) },
    {
      complete: apiKey ? nicrronCompletion(apiKey) : null,
      model: process.env.NICRRON_MODEL || "nicrron/auto",
      rateLimitStore: resolveRateLimitStore(),
      traceConfigured: isPrismConfigured(),
      trace: (event) => traces.push(event)
    }
  );
  if (traces.length) after(() => Promise.all(traces.map((event) => emitPrismTrace(event))));

  return jsonResponse(outcome.body, {
    status: outcome.status,
    headers: outcome.retryAfterSeconds ? { "Retry-After": String(outcome.retryAfterSeconds) } : {}
  });
}
