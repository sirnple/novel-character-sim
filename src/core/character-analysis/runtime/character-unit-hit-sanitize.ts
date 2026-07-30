/**
 * Stage-1 unit hit cleanup: drop suspended deictics as primary name;
 * promote a solid label from aliases when possible.
 */

import type { UnitNameHit } from "./character-name-aggregate";
import {
  isBarePronounOrGeneric,
  isFirstOrSecondPersonDeictic,
  isInvalidUnitPrimaryName,
  isUnanchoredRelationLabel,
} from "./character-entity-types";
import { orientNameAndAliases } from "./character-name-consolidate";

function cleanLabel(s: string): string {
  return String(s || "").replace(/\s+/g, "").trim();
}

function isNoiseAlias(s: string): boolean {
  return (
    isBarePronounOrGeneric(s) ||
    isFirstOrSecondPersonDeictic(s) ||
    s.length < 1 ||
    s.length > 24
  );
}

/**
 * Sanitize one LLM unit hit.
 * - Prefer solid name among name+aliases (soft orient)
 * - Drop row if primary is still unanchored relation / pronoun with no solid alias
 * - Relation words may remain in aliases when bound to a solid name
 */
export function sanitizeUnitNameHit(
  raw: { name?: string; aliases?: string[]; count?: number } | null | undefined,
): UnitNameHit | null {
  if (!raw) return null;
  let name = cleanLabel(raw.name || "");
  let aliases = Array.from(
    new Set(
      (raw.aliases || [])
        .map(cleanLabel)
        .filter((a) => a && a !== name && !isNoiseAlias(a)),
    ),
  );

  if (!name || name.length > 24) {
    // Promote first solid alias
    const solid = aliases.find((a) => !isInvalidUnitPrimaryName(a));
    if (!solid) return null;
    name = solid;
    aliases = aliases.filter((a) => a !== solid);
  }

  // Soft pick among surfaces (e.g. name=小儿子 aliases=[周屿] → 周屿)
  const oriented = orientNameAndAliases({ name, aliases });
  name = cleanLabel(oriented.name);
  aliases = Array.from(
    new Set(
      (oriented.aliases || [])
        .map(cleanLabel)
        .filter((a) => a && a !== name && !isNoiseAlias(a)),
    ),
  );

  if (!name || isInvalidUnitPrimaryName(name)) {
    const solid = aliases.find((a) => !isInvalidUnitPrimaryName(a));
    if (!solid) return null;
    aliases = [name, ...aliases].filter(
      (a) => a && a !== solid && !isNoiseAlias(a) && !isBarePronounOrGeneric(a),
    );
    // Keep relation form as alias if it was the old name
    if (
      name &&
      isUnanchoredRelationLabel(name) &&
      !aliases.includes(name) &&
      name.length <= 24
    ) {
      aliases = [name, ...aliases];
    }
    name = solid;
    aliases = aliases.filter((a) => a !== name);
  }

  // Final guard
  if (!name || isInvalidUnitPrimaryName(name) || isBarePronounOrGeneric(name)) {
    return null;
  }

  return {
    name,
    aliases,
    count: raw.count && raw.count > 0 ? raw.count : 1,
  };
}
