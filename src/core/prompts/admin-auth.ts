import { NextRequest } from "next/server";
import { runtimeEnvOptional } from "@/lib/runtime-env";

/**
 * No default password. Requires ADMIN_PASSWORD at container runtime.
 * Must use runtimeEnvOptional — not process.env.ADMIN_PASSWORD (build-time empty).
 */
function adminPassword(): string | null {
  return runtimeEnvOptional("ADMIN_PASSWORD");
}

// Simple in-memory session — resets on server restart
let activeToken: string | null = null;

export type VerifyPasswordResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_configured" | "invalid" };

export function verifyPassword(password: string): VerifyPasswordResult {
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
  activeToken = "admin_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return { ok: true, token: activeToken };
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  return token === activeToken && activeToken !== null;
}
