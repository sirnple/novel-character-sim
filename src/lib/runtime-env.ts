/**
 * Runtime environment access for Docker / Railway.
 *
 * Next.js webpack often freezes `process.env` to the keys present at
 * `next build` time. Variables only set at container start (e.g. Railway
 * secrets like ADMIN_PASSWORD) then look "missing". Reading through
 * Node's real process object avoids that.
 */
import nodeProcess from "node:process";

export function runtimeEnv(name: string, fallback: string = ""): string {
  const v = nodeProcess.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  return String(v);
}

/** Returns null when unset or whitespace-only (no insecure defaults). */
export function runtimeEnvOptional(name: string): string | null {
  const v = nodeProcess.env[name];
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}
