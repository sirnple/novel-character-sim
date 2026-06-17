/**
 * Simple in-memory rate limiter keyed by IP.
 *
 * NOTE: This is per-process.  Behind a load balancer with multiple instances,
 * use Redis or a similar shared store instead.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;    // e.g. 60_000 for 1 minute
  maxRequests: number; // max requests in that window
}

const store = new Map<string, Map<string, RateLimitEntry>>();

// Periodically clean up expired entries (every 5 min)
const CLEANUP_MS = 5 * 60_000;
let lastCleanup = Date.now();

function cleanExpired(): void {
  if (Date.now() - lastCleanup < CLEANUP_MS) return;
  lastCleanup = Date.now();
  store.forEach((buckets, ip) => {
    buckets.forEach((entry, endpoint) => {
      if (Date.now() > entry.resetAt) buckets.delete(endpoint);
    });
    if (buckets.size === 0) store.delete(ip);
  });
}

export function checkRateLimit(
  ip: string,
  endpoint: string,
  config: RateLimitConfig
): { allowed: boolean; resetAt: number } {
  cleanExpired();

  const now = Date.now();
  let buckets = store.get(ip);
  if (!buckets) {
    buckets = new Map();
    store.set(ip, buckets);
  }

  let entry = buckets.get(endpoint);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.windowMs };
    buckets.set(endpoint, entry);
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    return { allowed: false, resetAt: entry.resetAt };
  }

  return { allowed: true, resetAt: entry.resetAt };
}

/**
 * Extract client IP from a NextRequest.
 * Prefers x-forwarded-for (reverse proxy / Railway), falls back to local.
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Cloudflare / some proxies use cf-connecting-ip
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "127.0.0.1";
}
