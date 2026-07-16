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

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;       // max requests in window
  resetAt: number;      // when the window resets (ms timestamp)
}

export function checkRateLimit(
  ip: string,
  endpoint: string,
  config: RateLimitConfig
): RateLimitResult {
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

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const allowed = entry.count <= config.maxRequests;

  return { allowed, remaining, limit: config.maxRequests, resetAt: entry.resetAt };
}

/**
 * Query current rate-limit status WITHOUT incrementing the counter.
 * Used by /api/limit-status to show remaining quota.
 */
export function queryRateLimit(
  ip: string,
  endpoint: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanExpired();

  const now = Date.now();
  let buckets = store.get(ip);
  if (!buckets) {
    return { allowed: true, remaining: config.maxRequests, limit: config.maxRequests, resetAt: now + config.windowMs };
  }

  const entry = buckets.get(endpoint);
  if (!entry || now > entry.resetAt) {
    return { allowed: true, remaining: config.maxRequests, limit: config.maxRequests, resetAt: now + config.windowMs };
  }

  const remaining = Math.max(0, config.maxRequests - entry.count);
  return { allowed: remaining > 0, remaining, limit: config.maxRequests, resetAt: entry.resetAt };
}

/**
 * Format rate limit error message with counts and time.
 */
export function rateLimitMessage(result: RateLimitResult): string {
  const sec = Math.ceil((result.resetAt - Date.now()) / 1000);
  return `请求太频繁（${result.remaining}/${result.limit} 可用），请 ${sec} 秒后重试`;
}

/**
 * Set standard rate-limit response headers.
 */
export function setRateLimitHeaders(headers: Headers, result: RateLimitResult): void {
  headers.set("X-RateLimit-Limit", String(result.limit));
  headers.set("X-RateLimit-Remaining", String(result.remaining));
  headers.set("X-RateLimit-Reset", String(result.resetAt));
}

/**
 * Extract client IP from a NextRequest.
 * Prefers x-forwarded-for (reverse proxy / Railway), falls back to local.
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "127.0.0.1";
}

/**
 * Effective data-isolation id: logged-in user, else cookie guest.
 * (Implementation in auth.ts — cookie guest + session.)
 */
export { getUserId } from "@/lib/auth";
