/**
 * Admin user bootstrap via env.
 * ADMIN_EMAILS=a@x.com,b@y.com  → those accounts get isAdmin.
 */
import { runtimeEnvOptional } from "@/lib/runtime-env";

export function parseAdminEmails(): Set<string> {
  const raw = runtimeEnvOptional("ADMIN_EMAILS") || "";
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.includes("@")) set.add(e);
  }
  return set;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().has(email.trim().toLowerCase());
}
