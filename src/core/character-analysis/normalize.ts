import type { Character, Mention } from "./types";

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function normalizeMention(raw: unknown): Mention | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const surface =
    asString(o.surface) || asString(o.name) || asString(o.text);
  if (!surface) return null;
  const textAnchor =
    asString(o.textAnchor) ||
    asString(o.text_anchor) ||
    asString(o.anchor) ||
    surface;
  return { surface, textAnchor };
}

function normalizeCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.mentions)
    ? o.mentions
    : Array.isArray(o.mention)
      ? o.mention
      : [];
  const mentions: Mention[] = [];
  for (const m of list) {
    const nm = normalizeMention(m);
    if (nm) mentions.push(nm);
  }
  // LLM sometimes returns a bare surface list
  if (!mentions.length && (o.surface || o.name)) {
    const m = normalizeMention(o);
    if (m) mentions.push(m);
  }
  if (!mentions.length) return null;
  const gender = asString(o.gender) || undefined;
  const age = asString(o.age) || undefined;
  return {
    mentions,
    ...(gender ? { gender } : {}),
    ...(age ? { age } : {}),
  };
}

/**
 * Accept array root, or { characters: [] } / { items: [] } wrappers.
 */
export function charactersFromLlmWire(raw: unknown): Character[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.characters)) list = o.characters;
    else if (Array.isArray(o.items)) list = o.items;
    else if (Array.isArray(o.data)) list = o.data;
    else if (Array.isArray(o.result)) list = o.result;
  }
  const out: Character[] = [];
  for (const item of list) {
    const c = normalizeCharacter(item);
    if (c) out.push(c);
  }
  return out;
}
