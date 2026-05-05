// Lightweight in-memory token-bucket limiter for auth-sensitive endpoints.
// Per-process state, which is fine on Vercel because (a) most endpoints we
// care about aren't getting hammered by a single instance and (b) we want
// graceful degradation, not perfect distributed accuracy. If we later need
// truly distributed limits (e.g. coordinated brute-force across regions),
// swap this for @upstash/ratelimit without changing call sites.
//
// Usage:
//   const ok = checkRateLimit(`passkey-verify:${ip}`, { capacity: 10, refillPerMinute: 10 });
//   if (!ok) return new NextResponse(null, { status: 429 });

type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

// Periodic GC so the map doesn't grow unbounded across the lifetime of a
// long-lived serverless instance. Keys idle for over an hour are dropped.
const GC_AFTER_MS = 60 * 60 * 1000;
let lastGc = Date.now();

export type RateLimitOptions = {
  /** Maximum number of tokens the bucket can hold. */
  capacity: number;
  /** Tokens added per minute. */
  refillPerMinute: number;
};

export function checkRateLimit(key: string, opts: RateLimitOptions): boolean {
  maybeGc();

  const now = Date.now();
  const refillRate = opts.refillPerMinute / 60_000; // tokens per ms
  const bucket = buckets.get(key) ?? {
    tokens: opts.capacity,
    lastRefill: now,
  };

  const elapsed = now - bucket.lastRefill;
  const refilled = Math.min(opts.capacity, bucket.tokens + elapsed * refillRate);

  if (refilled < 1) {
    // Update lastRefill so we don't lose track of partial refills, but
    // signal "denied" to the caller.
    buckets.set(key, { tokens: refilled, lastRefill: now });
    return false;
  }

  buckets.set(key, { tokens: refilled - 1, lastRefill: now });
  return true;
}

/** Build a stable client identifier from a Next.js request. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
  return ip;
}

function maybeGc() {
  const now = Date.now();
  if (now - lastGc < GC_AFTER_MS) return;
  lastGc = now;
  for (const [k, v] of buckets) {
    if (now - v.lastRefill > GC_AFTER_MS) buckets.delete(k);
  }
}
