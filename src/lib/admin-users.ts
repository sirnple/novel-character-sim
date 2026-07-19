/**
 * Admin user bootstrap via env.
 * ADMIN_EMAILS=a@x.com,b@y.com  → those accounts get isAdmin.
 * Also accepts singular ADMIN_EMAIL.
 */
import { runtimeEnvOptional } from "@/lib/runtime-env";

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function parseAdminEmails(): Set<string> {
  const raw =
    runtimeEnvOptional("ADMIN_EMAILS") ||
    runtimeEnvOptional("ADMIN_EMAIL") ||
    "";
  const set = new Set<string>();
  for (const part of raw.split(/[,;\n\r]+/)) {
    const e = stripQuotes(part).toLowerCase();
    if (e.includes("@")) set.add(e);
  }
  return set;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().has(stripQuotes(email).toLowerCase());
}

/** How many admin emails are configured (for diagnostics, no values leaked). */
export function adminEmailsConfiguredCount(): number {
  return parseAdminEmails().size;
}
