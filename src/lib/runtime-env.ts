/**
 * Runtime environment access for Docker / Railway.
 *
 * Next.js webpack often freezes `process.env.FOO` (static key) to the value
 * present at `next build`. Variables only set at container start (e.g. Railway
 * secrets) then look "missing". Always read via dynamic key access so the
 * live process env is used.
 */

function readRaw(name: string): string | undefined {
  // Dynamic key — must not be rewritten to a build-time constant.
  try {
    // Prefer the real Node process (standalone server.js)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeProc = require("node:process") as NodeJS.Process;
    const a = nodeProc?.env?.[name];
    if (a !== undefined && a !== null && String(a).length > 0) return String(a);
  } catch {
    /* ignore */
  }
  try {
    const b = typeof process !== "undefined" ? process.env[name] : undefined;
    if (b !== undefined && b !== null && String(b).length > 0) return String(b);
  } catch {
    /* ignore */
  }
  return undefined;
}

export function runtimeEnv(name: string, fallback: string = ""): string {
  const v = readRaw(name);
  if (v === undefined || v.trim() === "") return fallback;
  return v.trim();
}

/** Returns null when unset or whitespace-only (no insecure defaults). */
export function runtimeEnvOptional(name: string): string | null {
  const v = readRaw(name);
  if (v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
