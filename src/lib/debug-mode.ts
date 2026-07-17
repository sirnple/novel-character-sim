/**
 * Dev/debug gates for tooling that must not ship to end users.
 *
 * Enable extra tools with:
 * - NODE_ENV=development (default local `npm run dev`)
 * - or DEBUG_TOOLS=1 / NEXT_PUBLIC_DEBUG_TOOLS=1
 */

export function isServerDebugMode(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const v = (process.env.DEBUG_TOOLS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Client-safe: only public env or compile-time NODE_ENV. */
export function isClientDebugMode(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const v = (process.env.NEXT_PUBLIC_DEBUG_TOOLS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
