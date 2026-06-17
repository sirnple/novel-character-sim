"use client";

import { useState, useEffect } from "react";

/**
 * Parse rate-limit info from the new error format:
 * "请求太频繁（0/20 可用），请 45 秒后重试"
 */
export function parseRateLimitInfo(msg: string): {
  remaining: number;
  limit: number;
  seconds: number;
} | null {
  // New format: "请求太频繁（0/20 可用），请 45 秒后重试"
  const m = msg.match(/(\d+)\s*\/\s*(\d+)\s*可用.*?(\d+)\s*秒/);
  if (m) {
    return { remaining: parseInt(m[1]), limit: parseInt(m[2]), seconds: parseInt(m[3]) };
  }
  // Old format fallback: "请求太频繁，请 X 秒后重试"
  const old = msg.match(/(\d+)\s*秒后重试/);
  if (old) return { remaining: 0, limit: 0, seconds: parseInt(old[1]) };
  return null;
}

/**
 * Displays a rate-limit error with live countdown and quota info.
 * Format: "⏳ 0/20 可用 · 等待 45 秒后恢复"
 */
export function useRateLimitCooldown(errorMsg: string): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [info, setInfo] = useState<{ remaining: number; limit: number; seconds: number } | null>(null);

  useEffect(() => {
    const parsed = parseRateLimitInfo(errorMsg);
    if (!parsed) { setRemaining(null); setInfo(null); return; }
    setInfo(parsed);
    setRemaining(parsed.seconds);

    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) { clearInterval(timer); return null; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [errorMsg]);

  if (remaining === null || !info) return null;
  const quota = info.limit > 0 ? `${info.remaining}/${info.limit} 可用 · ` : "";
  return `⏳ ${quota}等待 ${remaining} 秒后恢复`;
}
