/**
 * Fixed-window rate limiting for the paid endpoints (Nicrron, ElevenLabs).
 *
 * Deployed environments need a shared store because serverless instances do not share memory:
 * CloseMate uses Upstash Redis over its REST API (UPSTASH_REDIS_REST_URL / _TOKEN, or the
 * KV_REST_API_URL / _TOKEN names injected by the Vercel Marketplace integration).
 * Without it, paid calls are disabled in production builds rather than left unlimited.
 */

export type RateLimitRule = { scope: "client" | "global"; limit: number; windowSeconds: number };

export type PaidEndpoint = "analyze" | "speak";

export const RATE_LIMIT_POLICY: Record<PaidEndpoint, readonly RateLimitRule[]> = {
  analyze: [
    { scope: "client", limit: 10, windowSeconds: 60 },
    { scope: "client", limit: 60, windowSeconds: 3600 },
    { scope: "global", limit: 500, windowSeconds: 86_400 }
  ],
  speak: [
    { scope: "client", limit: 4, windowSeconds: 60 },
    { scope: "client", limit: 20, windowSeconds: 3600 },
    { scope: "global", limit: 100, windowSeconds: 86_400 }
  ]
};

export interface RateLimitStore {
  readonly kind: "upstash" | "memory";
  /** Atomically increments the counter for `key` and returns the new value. */
  increment(key: string, ttlSeconds: number): Promise<number>;
}

export type RateLimitDecision =
  | { allowed: true; store: RateLimitStore["kind"] }
  | { allowed: false; reason: "limited"; retryAfterSeconds: number }
  | { allowed: false; reason: "unconfigured" | "store_error" };

type Env = Readonly<Record<string, string | undefined>>;

export function createUpstashStore(url: string, token: string, fetchImpl: typeof fetch = fetch): RateLimitStore {
  const endpoint = `${url.replace(/\/$/, "")}/pipeline`;
  return {
    kind: "upstash",
    async increment(key, ttlSeconds) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(ttlSeconds)]]),
        signal: AbortSignal.timeout(1500),
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Rate-limit store returned HTTP ${response.status}.`);
      const data = (await response.json()) as Array<{ result?: unknown; error?: unknown }>;
      const count = Array.isArray(data) ? data[0]?.result : undefined;
      if (typeof count !== "number") throw new Error("Rate-limit store returned an unexpected response.");
      return count;
    }
  };
}

/** Per-process counters. Only acceptable for local development or an access-protected preview. */
export function createMemoryStore(now: () => number = Date.now): RateLimitStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  return {
    kind: "memory",
    async increment(key, ttlSeconds) {
      const time = now();
      if (counters.size > 10_000) for (const [k, v] of counters) if (v.expiresAt <= time) counters.delete(k);
      const current = counters.get(key);
      const next = current && current.expiresAt > time ? { ...current, count: current.count + 1 } : { count: 1, expiresAt: time + ttlSeconds * 1000 };
      counters.set(key, next);
      return next.count;
    }
  };
}

let devMemoryStore: RateLimitStore | null = null;

/**
 * Chooses the limiter backing store for this environment, or null when paid calls must stay off.
 * - Upstash configured: shared limiter (any environment).
 * - `next dev` / tests (NODE_ENV !== "production"): in-memory limiter.
 * - Vercel Preview with CLOSEMATE_PREVIEW_IN_MEMORY_RATE_LIMIT=true: in-memory, best effort only.
 * - Anything else built for production: null → paid providers are not called.
 */
export function resolveRateLimitStore(env: Env = process.env, fetchImpl: typeof fetch = fetch): RateLimitStore | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return createUpstashStore(url, token, fetchImpl);
  const previewOptIn = env.VERCEL_ENV === "preview" && env.CLOSEMATE_PREVIEW_IN_MEMORY_RATE_LIMIT === "true";
  if (env.NODE_ENV !== "production" || previewOptIn) return (devMemoryStore ??= createMemoryStore());
  return null;
}

export async function checkRateLimit(
  store: RateLimitStore | null,
  endpoint: PaidEndpoint,
  clientKey: string,
  now: () => number = Date.now
): Promise<RateLimitDecision> {
  if (!store) return { allowed: false, reason: "unconfigured" };
  const nowSeconds = Math.floor(now() / 1000);
  try {
    for (const rule of RATE_LIMIT_POLICY[endpoint]) {
      const window = Math.floor(nowSeconds / rule.windowSeconds);
      const subject = rule.scope === "global" ? "all" : clientKey;
      const key = `closemate:rl:${endpoint}:${rule.scope}:${rule.windowSeconds}:${subject}:${window}`;
      const count = await store.increment(key, rule.windowSeconds + 5);
      if (count > rule.limit) {
        return { allowed: false, reason: "limited", retryAfterSeconds: Math.max(1, (window + 1) * rule.windowSeconds - nowSeconds) };
      }
    }
  } catch {
    return { allowed: false, reason: "store_error" };
  }
  return { allowed: true, store: store.kind };
}
