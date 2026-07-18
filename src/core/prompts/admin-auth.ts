import { NextRequest } from "next/server";
import { runtimeEnvOptional } from "@/lib/runtime-env";
import { isServerDebugMode } from "@/lib/debug-mode";

/**
 * Production: requires ADMIN_PASSWORD (runtime env).
 * Debug / development: no password — any login mints a session token.
 * Must use runtimeEnvOptional — not process.env.ADMIN_PASSWORD (build-time empty).
 */
function adminPassword(): string | null {
  return runtimeEnvOptional("ADMIN_PASSWORD");
}

// Simple in-memory session — resets on server restart
let activeToken: string | null = null;

function mintToken(prefix = "admin_"): string {
  activeToken =
    prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return activeToken;
}

export type VerifyPasswordResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_configured" | "invalid" };

export function verifyPassword(password: string): VerifyPasswordResult {
  // Local/debug: skip password (and allow even when ADMIN_PASSWORD unset).
  // Reuse existing debug token so React Strict Mode double-mount / parallel
  // unlocks don't invalidate a token the client just stored.
  if (isServerDebugMode()) {
    if (activeToken?.startsWith("admin_debug_")) {
      return { ok: true, token: activeToken };
    }
    return { ok: true, token: mintToken("admin_debug_") };
  }

  const secret = adminPassword();
  if (!secret) {
    console.error(
      "[admin-auth] ADMIN_PASSWORD is not set at runtime — admin login disabled",
    );
    return { ok: false, reason: "not_configured" };
  }
  if (!password || password !== secret) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, token: mintToken("admin_") };
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  if (!token) return false;
  // Debug: any mint from this process is enough (avoids Strict Mode remount
  // races where a second mint would otherwise invalidate the first).
  if (isServerDebugMode() && token.startsWith("admin_debug_")) return true;
  return token === activeToken;
}
