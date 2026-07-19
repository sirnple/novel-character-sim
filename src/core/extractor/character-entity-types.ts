/**
 * Shared types for character entity resolve (agent + frequency).
 */

export interface ResolvedEntity {
  /** Real personal name (真实姓名) */
  name: string;
  /** Titles / epithets / short forms for the SAME person */
  aliases: string[];
  role?: string;
  briefDescription?: string;
  /** All surfaces attributed for counting */
  surfaces?: string[];
}

export function normalizeResolvedEntities(
  raw: ResolvedEntity[] | undefined | null,
): ResolvedEntity[] {
  if (!raw?.length) return [];
  const out: ResolvedEntity[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const name = (e.name || "").trim();
    if (!name || name.length > 16) continue;
    const key = name.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const aliases = Array.from(
      new Set(
        (e.aliases || [])
          .map((a) => String(a).trim())
          .filter((a) => a && a.replace(/\s+/g, "") !== key),
      ),
    );
    const surfaces = Array.from(
      new Set(
        [name, ...aliases, ...(e.surfaces || [])]
          .map((s) => String(s).trim())
          .filter(Boolean),
      ),
    );
    out.push({
      name,
      aliases,
      role: e.role || "supporting",
      briefDescription: (e.briefDescription || "").trim() || undefined,
      surfaces,
    });
  }
  return out;
}

export const SUBMIT_ENTITIES_OK = "角色实体已存";
