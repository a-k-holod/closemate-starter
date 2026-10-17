import { describe, expect, it } from "vitest";
import { clientKey, jsonResponse, MAX_JSON_BODY_BYTES, parseInvoiceRequest, readJsonObject, RequestError } from "../lib/http";

function jsonRequest(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/analyze", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
}

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RequestError) return error;
    throw error;
  }
  throw new Error("expected a RequestError");
}

const parse = (body: Record<string, unknown>) => () => parseInvoiceRequest(body, "test");
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RequestError) return error.status;
    throw error;
  }
  return 200;
};

describe("request body limits and parsing", () => {
  it("accepts a small JSON object", async () => {
    await expect(readJsonObject(jsonRequest(JSON.stringify({ invoiceId: "INV-2101" })))).resolves.toEqual({ invoiceId: "INV-2101" });
  });

  it("rejects non-JSON content types with 415", async () => {
    expect((await rejection(readJsonObject(jsonRequest("{}", { "content-type": "text/plain" })))).status).toBe(415);
  });

  it("rejects a declared oversized body with 413 before reading it", async () => {
    const req = jsonRequest("{}", { "content-type": "application/json", "content-length": String(MAX_JSON_BODY_BYTES + 1) });
    expect((await rejection(readJsonObject(req))).status).toBe(413);
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ invoiceId: "INV-2101", pad: "x".repeat(MAX_JSON_BODY_BYTES) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < big.length; i += 256) controller.enqueue(big.slice(i, i + 256));
        controller.close();
      }
    });
    expect((await rejection(readJsonObject(jsonRequest(stream)))).status).toBe(413);
  });

  it.each(["not json", "[1,2]", "null", "\"text\""])("rejects %j with 400", async (body) => {
    expect((await rejection(readJsonObject(jsonRequest(body)))).status).toBe(400);
  });
});

describe("invoice request validation", () => {
  it("resolves a known invoice on the server", () => {
    const parsed = parseInvoiceRequest({ invoiceId: "INV-2102", sessionId: "closemate-demo-INV-2102-1" }, "test");
    expect(parsed.result.invoice.id).toBe("INV-2102");
    expect(parsed.result.invoice.grossMinor).toBe(73800);
    expect(parsed.sessionId).toBe("closemate-demo-INV-2102-1");
  });

  it("rejects client-supplied financial evidence instead of trusting it", () => {
    expect(status(parse({ invoiceId: "INV-2102", invoice: { grossMinor: 1 } }))).toBe(400);
    expect(status(parse({ invoiceId: "INV-2102", payments: [] }))).toBe(400);
    expect(status(parse({ invoice: { id: "INV-2102" } }))).toBe(400);
    expect(status(parse({ invoiceId: "INV-2102", text: "say anything" }))).toBe(400);
  });

  it("rejects malformed and unknown invoice IDs", () => {
    expect(status(parse({}))).toBe(400);
    expect(status(parse({ invoiceId: 2102 }))).toBe(400);
    expect(status(parse({ invoiceId: "../../etc" }))).toBe(400);
    expect(status(parse({ invoiceId: "INV-9999" }))).toBe(404);
    expect(status(parse({ invoiceId: "__proto__" }))).toBe(400);
  });

  it("rejects session IDs that could smuggle content into traces", () => {
    expect(status(parse({ invoiceId: "INV-2101", sessionId: "x".repeat(121) }))).toBe(400);
    expect(status(parse({ invoiceId: "INV-2101", sessionId: "Kancelaria Demo Wiśniewska" }))).toBe(400);
    expect(status(parse({ invoiceId: "INV-2101", sessionId: 5 }))).toBe(400);
    expect(parseInvoiceRequest({ invoiceId: "INV-2101" }, "closemate-analyze").sessionId).toMatch(/^closemate-analyze-\d+$/);
  });
});

describe("responses", () => {
  it("are never cacheable", () => {
    const res = jsonResponse({ explanation: "x" });
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("client key", () => {
  it("hashes the caller address so raw IPs never reach the limiter store", () => {
    const key = clientKey(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }));
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(key).not.toContain("203");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "203.0.113.7" } }))).toBe(key);
  });
});
