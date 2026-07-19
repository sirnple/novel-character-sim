/**
 * Runtime environment access for Docker / Railway.
 *
 * Next.js may rewrite static `process.env.FOO` at build time. Always use
 * dynamic key access against the live process env object.
 */

function liveEnv(): Record<string, string | undefined> {
  // Avoid webpack static analysis replacing process.env with a frozen object.
  try {
    const env = new Function(
      "return (typeof process !== 'undefined' && process.env) || {}",
    )() as Record<string, string | undefined>;
    if (env && typeof env === "object") return env;
  } catch {
    /* ignore */
  }
  try {
    const g = globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    };
    if (g.process?.env) return g.process.env;
  } catch {
    /* ignore */
  }
  return {};
}

function readRaw(name: string): string | undefined {
  const v = liveEnv()[name];
  if (v === undefined || v === null) return undefined;
  return String(v);
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

/** Diagnostic: env key names that look admin-related (values never returned). */
export function adminRelatedEnvKeys(): string[] {
  return Object.keys(liveEnv())
    .filter((k) => /ADMIN|EMAIL/i.test(k))
    .sort();
}
