import { NextRequest } from "next/server";
import { isServerDebugMode } from "@/lib/debug-mode";
import { resolveAuth } from "@/lib/auth";

/**
 * Admin access:
 * 1. Logged-in user with isAdmin (ADMIN_EMAILS / users.is_admin) — production path
 * 2. Debug/dev auto-token for local work
 *
 * Shared ADMIN_PASSWORD is no longer enough to enter /admin; use admin user accounts.
 */

// Simple in-memory session token — resets on server restart
let activeToken: string | null = null;

function mintToken(prefix = "admin_"): string {
  activeToken =
    prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return activeToken;
}

export type VerifyPasswordResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_configured" | "invalid" | "not_admin" };

/**
 * Unlock admin APIs: logged-in admin user, or debug mode.
 */
export function verifyAdminAccess(
  req: NextRequest,
  _password?: string,
): VerifyPasswordResult {
  const auth = resolveAuth(req);
  if (auth.user?.isAdmin) {
    if (activeToken?.startsWith("admin_user_")) {
      return { ok: true, token: activeToken };
    }
    return { ok: true, token: mintToken("admin_user_") };
  }

  // Local/debug only
  if (isServerDebugMode()) {
    if (activeToken?.startsWith("admin_debug_")) {
      return { ok: true, token: activeToken };
    }
    return { ok: true, token: mintToken("admin_debug_") };
  }

  return { ok: false, reason: "not_admin" };
}

/** @deprecated Prefer verifyAdminAccess */
export function verifyPassword(password: string): VerifyPasswordResult {
  void password;
  if (isServerDebugMode()) {
    if (activeToken?.startsWith("admin_debug_")) {
      return { ok: true, token: activeToken };
    }
    return { ok: true, token: mintToken("admin_debug_") };
  }
  return { ok: false, reason: "not_admin" };
}

export function isAdmin(req: NextRequest): boolean {
  // Preferred: logged-in admin user (session cookie)
  try {
    const auth = resolveAuth(req);
    if (auth.user?.isAdmin) return true;
  } catch {
    /* ignore */
  }

  const token = req.headers.get("x-admin-token");
  if (!token) return false;
  // Debug: any mint from this process is enough (avoids Strict Mode remount
  // races where a second mint would otherwise invalidate the first).
  if (isServerDebugMode() && token.startsWith("admin_debug_")) return true;
  return token === activeToken;
}
