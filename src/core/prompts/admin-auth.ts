import { NextRequest } from "next/server";

/**
 * Read at RUNTIME (bracket notation).
 * process.env.ADMIN_PASSWORD is inlined at Next.js build time and is empty
 * in Docker/Railway builds, so the old code always fell back to "admin".
 */
function adminPassword(): string {
  return (process.env as Record<string, string | undefined>)["ADMIN_PASSWORD"] || "admin";
}

// Simple in-memory session — resets on server restart
let activeToken: string | null = null;

export function verifyPassword(password: string): string | null {
  if (password !== adminPassword()) return null;
  activeToken = "admin_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return activeToken;
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  return token === activeToken && activeToken !== null;
}
