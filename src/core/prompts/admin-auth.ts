import { NextRequest } from "next/server";

/**
 * Read at RUNTIME (bracket notation).
 * process.env.ADMIN_PASSWORD is inlined at Next.js build time if written as
 * process.env.ADMIN_PASSWORD — always use bracket access for Railway/Docker.
 *
 * No default password: if ADMIN_PASSWORD is unset/empty, login always fails.
 */
function adminPassword(): string | null {
  const v = (process.env as Record<string, string | undefined>)["ADMIN_PASSWORD"];
  const trimmed = typeof v === "string" ? v.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

// Simple in-memory session — resets on server restart
let activeToken: string | null = null;

export type VerifyPasswordResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_configured" | "invalid" };

export function verifyPassword(password: string): VerifyPasswordResult {
  const secret = adminPassword();
  if (!secret) {
    console.error("[admin-auth] ADMIN_PASSWORD is not set — admin login disabled");
    return { ok: false, reason: "not_configured" };
  }
  if (!password || password !== secret) {
    return { ok: false, reason: "invalid" };
  }
  activeToken = "admin_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return { ok: true, token: activeToken };
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  return token === activeToken && activeToken !== null;
}
