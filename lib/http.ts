import { createHash } from "node:crypto";
import type { Locale } from "./locale";
import { parseLocale } from "./locale";
import { messagesFor } from "./messages";
import { results, type ReconciliationResult } from "./reconcile";

/** Both endpoints accept only `{ invoiceId, sessionId?, locale? }`, so a few hundred bytes is plenty. */
export const MAX_JSON_BODY_BYTES = 2048;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE_HEADERS, ...init.headers }
  });
}

export function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...NO_STORE_HEADERS, ...extra };
}

export class RequestError extends Error {
  constructor(readonly status: 400 | 404 | 413 | 415, message: string) {
    super(message);
  }
}

/** Reads a JSON object body with a hard byte cap, including chunked bodies without Content-Length. */
export async function readJsonObject(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) throw new RequestError(415, "Content-Type must be application/json.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestError(413, "Request body is too large.");
  if (!request.body) throw new RequestError(400, "Request body must be a JSON object.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, "Request body must be valid JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new RequestError(400, "Request body must be a JSON object.");
  return data as Record<string, unknown>;
}

const INVOICE_ID_PATTERN = /^[A-Z]{3}-\d{4}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const ALLOWED_FIELDS = new Set(["invoiceId", "sessionId", "locale"]);

export type InvoiceRequest = { result: ReconciliationResult; sessionId: string; locale: Locale };

/**
 * Validates `{ invoiceId, sessionId?, locale? }` and resolves the invoice on the server.
 * Financial evidence is never taken from the client: only the ID is trusted, and only if it is known.
 * `locale` must be the enum `en` or `pl`; anything else is treated as English and is not echoed.
 */
export function parseInvoiceRequest(body: Record<string, unknown>, fallbackSessionPrefix: string, known: readonly ReconciliationResult[] = results): InvoiceRequest {
  const locale = parseLocale(body.locale);
  const copy = messagesFor(locale).api;
  const unexpected = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length) throw new RequestError(400, copy.onlyKnownFields);
  const { invoiceId, sessionId } = body;
  if (typeof invoiceId !== "string" || !INVOICE_ID_PATTERN.test(invoiceId)) throw new RequestError(400, copy.invoiceId);
  if (sessionId !== undefined && (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId))) {
    throw new RequestError(400, copy.sessionId);
  }
  const result = known.find((r) => r.invoice.id === invoiceId);
  if (!result) throw new RequestError(404, copy.unknownInvoice);
  return { result, sessionId: typeof sessionId === "string" ? sessionId : `${fallbackSessionPrefix}-${Date.now()}`, locale };
}

/**
 * Pseudonymous rate-limit subject. On Vercel, x-real-ip / x-forwarded-for are set by the platform edge.
 * The address is hashed so raw IPs are never written to the limiter store or logs.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("x-real-ip")?.trim() || forwarded || "unknown";
  return createHash("sha256").update(`closemate-rl:${ip}`).digest("hex").slice(0, 24);
}
