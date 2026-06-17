"use client";

import { useState, useEffect } from "react";

/**
 * Given an API error message, check if it's a rate-limit 429.
 * Expected format (Chinese): "请求太频繁，请 X 秒后重试"
 * Returns the seconds if parsed, else null.
 */
export function parseRateLimitSeconds(msg: string): number | null {
  const m = msg.match(/(\d+)\s*秒/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Displays a rate-limit error with a live countdown.
 * Once the countdown reaches 0 the error clears itself.
 */
export function useRateLimitCooldown(errorMsg: string): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const sec = parseRateLimitSeconds(errorMsg);
    if (!sec) { setRemaining(null); return; }
    setRemaining(sec);

    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) { clearInterval(timer); return null; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [errorMsg]);

  if (remaining === null) return null;
  return `⏳ 请求太频繁，请等待 ${remaining} 秒后重试`;
}
