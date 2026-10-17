import { describe, expect, it, vi } from "vitest";
import { checkRateLimit, createMemoryStore, createUpstashStore, RATE_LIMIT_POLICY, resolveRateLimitStore, type RateLimitStore } from "../lib/rate-limit";

describe("limiter selection", () => {
  it("uses Upstash when its REST credentials are configured, in any environment", () => {
    expect(resolveRateLimitStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://u.example", UPSTASH_REDIS_REST_TOKEN: "t" })?.kind).toBe("upstash");
    expect(resolveRateLimitStore({ NODE_ENV: "production", KV_REST_API_URL: "https://u.example", KV_REST_API_TOKEN: "t" })?.kind).toBe("upstash");
  });

  it("fails closed in production builds without a shared store", () => {
    expect(resolveRateLimitStore({ NODE_ENV: "production" })).toBeNull();
    expect(resolveRateLimitStore({ NODE_ENV: "production", VERCEL_ENV: "production", CLOSEMATE_PREVIEW_IN_MEMORY_RATE_LIMIT: "true" })).toBeNull();
    expect(resolveRateLimitStore({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBeNull();
    expect(resolveRateLimitStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://u.example" })).toBeNull();
  });

  it("allows an in-memory limiter only for local development or an explicit preview opt-in", () => {
    expect(resolveRateLimitStore({ NODE_ENV: "development" })?.kind).toBe("memory");
    expect(resolveRateLimitStore({ NODE_ENV: "production", VERCEL_ENV: "preview", CLOSEMATE_PREVIEW_IN_MEMORY_RATE_LIMIT: "true" })?.kind).toBe("memory");
  });
});

describe("fixed-window limits", () => {
  it("allows up to the per-client limit and then rejects with Retry-After", async () => {
    const store = createMemoryStore(() => 0);
    const limit = RATE_LIMIT_POLICY.analyze[0].limit;
    for (let i = 0; i < limit; i++) expect((await checkRateLimit(store, "analyze", "client-a", () => 0)).allowed).toBe(true);
    const denied = await checkRateLimit(store, "analyze", "client-a", () => 0);
    expect(denied).toEqual({ allowed: false, reason: "limited", retryAfterSeconds: 60 });
    expect((await checkRateLimit(store, "analyze", "client-b", () => 0)).allowed).toBe(true);
  });

  it("enforces a global cap across all clients", async () => {
    const store = createMemoryStore(() => 0);
    const global = RATE_LIMIT_POLICY.speak.find((r) => r.scope === "global")!;
    let last;
    for (let i = 0; i <= global.limit; i++) last = await checkRateLimit(store, "speak", `client-${i}`, () => 0);
    expect(last).toMatchObject({ allowed: false, reason: "limited" });
  });

  it("reports unconfigured and failing stores so callers can fail closed", async () => {
    expect(await checkRateLimit(null, "analyze", "c")).toEqual({ allowed: false, reason: "unconfigured" });
    const broken: RateLimitStore = { kind: "upstash", increment: () => Promise.reject(new Error("down")) };
    expect(await checkRateLimit(broken, "analyze", "c")).toEqual({ allowed: false, reason: "store_error" });
  });
});

describe("Upstash REST store", () => {
  it("increments and sets a TTL in one pipeline call with a bearer token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ result: 3 }, { result: 1 }]), { status: 200 }));
    const store = createUpstashStore("https://example.upstash.io/", "secret-token", fetchImpl as unknown as typeof fetch);
    expect(await store.increment("k", 65)).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.upstash.io/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string)).toEqual([["INCR", "k"], ["EXPIRE", "k", "65"]]);
  });

  it("throws on HTTP errors and malformed responses", async () => {
    const bad = createUpstashStore("https://x", "t", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    await expect(bad.increment("k", 1)).rejects.toThrow();
    const odd = createUpstashStore("https://x", "t", (async () => new Response(JSON.stringify([{ error: "ERR" }]))) as unknown as typeof fetch);
    await expect(odd.increment("k", 1)).rejects.toThrow();
  });
});
