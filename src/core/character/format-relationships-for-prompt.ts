/**
 * Shared formatter for directed character relationships in writing prompts.
 * Spec: docs/superpowers/specs/2026-07-19-character-relationship-model-design.md §0 + §4
 */
import type {
  CharacterProfile,
  Relationship,
  RelationshipSymmetry,
} from "@/types";
import {
  normalizeRelationshipTypeId,
  relationshipTypeZh,
} from "@/core/extractor/relationship-types";

export type FormatRelVoice = "first_person" | "third_person";
export type FormatRelPriority = "drama" | "strength" | "as_is";

export type FormatRelOpts = {
  zh?: boolean;
  /** Only edges whose target name is in this set (scene cast). */
  presentNames?: Set<string> | string[];
  maxEdges?: number;
  priority?: FormatRelPriority;
  voice?: FormatRelVoice;
  /** Short behavioral constraints (outline/writer on; review off). */
  withConstraints?: boolean;
  /**
   * Owner display name for third_person lines (A→B).
   * Defaults to profile.name.
   */
  ownerName?: string;
};

function toNameSet(
  present?: Set<string> | string[],
): Set<string> | null {
  if (!present) return null;
  if (present instanceof Set) return present;
  return new Set(present.filter(Boolean));
}

function symmetryLabel(
  s: RelationshipSymmetry | undefined,
  zh: boolean,
): string {
  if (s === "unidirectional") return zh ? "单向" : "unidirectional";
  if (s === "asymmetric") return zh ? "不对称" : "asymmetric";
  if (s === "bidirectional") return zh ? "双向" : "bidirectional";
  return "";
}

function typeLabel(type: string, zh: boolean): string {
  const id = normalizeRelationshipTypeId(type);
  if (zh) return relationshipTypeZh(id);
  return id;
}

function dramaScore(r: Relationship): number {
  let s = 0;
  const sym = r.symmetry;
  if (sym === "asymmetric") s += 1000;
  else if (sym === "unidirectional") s += 500;
  else if (sym === "bidirectional") s += 100;

  const v = (r.valence || "").toLowerCase();
  if (v === "negative" || v === "ambivalent" || v === "instrumental") s += 200;
  const vis = (r.visibility || "").toLowerCase();
  if (vis === "hidden" || vis === "private") s += 150;

  const t = normalizeRelationshipTypeId(r.type);
  const hot = new Set([
    "enemy",
    "rival",
    "captor",
    "affair",
    "lover",
    "master-servant",
    "patron",
    "ex",
  ]);
  if (hot.has(t)) s += 80;

  if (sym === "bidirectional" && (t === "enemy" || t === "rival" || t === "lover")) {
    s += 40;
  }

  s += Math.min(50, (r.description || "").length / 10);
  return s;
}

function constraintFor(r: Relationship, zh: boolean): string | null {
  const parts: string[] = [];
  if (r.symmetry === "unidirectional") {
    parts.push(
      zh
        ? "此关系主要为单方面；勿默认对方同等情感或义务。"
        : "Bond is largely one-sided; do not assume reciprocal feeling or duty.",
    );
  } else if (r.symmetry === "asymmetric") {
    parts.push(
      zh
        ? "双方不对等；行动与对话须体现权力或信息差。"
        : "Asymmetric dyad; show power or information imbalance.",
    );
  }
  const vis = (r.visibility || "").toLowerCase();
  if (vis === "hidden" || vis === "private") {
    parts.push(
      zh
        ? "勿在公开场合直接点破；可用潜台词。"
        : "Do not openly reveal this bond in public; subtext only.",
    );
  }
  const t = normalizeRelationshipTypeId(r.type);
  if (t === "affair" && r.symmetry !== "bidirectional") {
    parts.push(
      zh
        ? "勿写成已确认恋人/未婚夫妻。"
        : "Do not portray as confirmed lovers/spouses.",
    );
  }
  if (t === "captor") {
    parts.push(
      zh
        ? "被控方的恐惧、顺从或暗中反抗须可感。"
        : "Show fear, compliance, or covert resistance of the controlled party.",
    );
  }
  if (!parts.length) return null;
  return parts[0]; // keep one short constraint per edge
}

function selectEdges(
  profile: CharacterProfile,
  opts: FormatRelOpts,
): Relationship[] {
  const present = toNameSet(opts.presentNames);
  let edges = Array.isArray(profile.relationships)
    ? [...profile.relationships]
    : [];

  // Illegal legacy: no symmetry → drop (grill: old data purged; any leftover ignored)
  edges = edges.filter((r) => !!r.symmetry);

  if (present) {
    edges = edges.filter((r) => present.has(r.characterName));
  }

  const priority = opts.priority || "drama";
  if (priority === "drama") {
    edges.sort((a, b) => dramaScore(b) - dramaScore(a));
  } else if (priority === "strength") {
    edges.sort(
      (a, b) =>
        (b.description || "").length - (a.description || "").length,
    );
  }

  const max = opts.maxEdges;
  if (max != null && max >= 0 && edges.length > max) {
    edges = edges.slice(0, max);
  }
  return edges;
}

function formatOneEdge(
  ownerName: string,
  r: Relationship,
  opts: FormatRelOpts,
): string {
  const zh = !!opts.zh;
  const voice = opts.voice || "third_person";
  const type = typeLabel(r.type, zh);
  const sym = symmetryLabel(r.symmetry, zh);
  const bits: string[] = [type];
  if (sym) bits.push(sym);
  if (r.valence) bits.push(zh ? `情感:${r.valence}` : `valence:${r.valence}`);
  if (r.visibility) {
    bits.push(zh ? `可见:${r.visibility}` : `visibility:${r.visibility}`);
  }
  if (r.reverseType && r.symmetry === "asymmetric") {
    const rt = typeLabel(r.reverseType, zh);
    bits.push(zh ? `回:${rt}` : `rev:${rt}`);
  }

  const head =
    voice === "first_person"
      ? zh
        ? `你 → ${r.characterName}`
        : `you → ${r.characterName}`
      : `${ownerName} → ${r.characterName}`;

  const meta = bits.join(zh ? " · " : " | ");
  let line = `- ${head}：${meta}`;
  if (r.description?.trim()) {
    line += zh
      ? `\n  ${r.description.trim()}`
      : `\n  ${r.description.trim()}`;
  }
  if (opts.withConstraints) {
    const c = constraintFor(r, zh);
    if (c) line += zh ? `\n  约束：${c}` : `\n  Constraint: ${c}`;
  }
  return line;
}

/**
 * Format one profile's out-edges for prompts.
 * Returns empty string if no valid (symmetry-tagged) edges.
 */
export function formatRelationshipsForPrompt(
  profile: CharacterProfile,
  opts: FormatRelOpts = {},
): string {
  const zh = opts.zh ?? true;
  const edges = selectEdges(profile, opts);
  if (!edges.length) return "";

  const ownerName = opts.ownerName || profile.name;
  const header = zh ? `### ${ownerName} 的人际关系（有向）` : `### ${ownerName} relationships (directed)`;
  const body = edges
    .map((r) => formatOneEdge(ownerName, r, { ...opts, zh }))
    .join("\n");
  return `${header}\n${body}`;
}

/**
 * Scene bundle: each present character's out-edges to other present cast.
 */
export function formatSceneRelationshipBundle(
  present: CharacterProfile[],
  opts: Omit<FormatRelOpts, "presentNames" | "ownerName"> = {},
): string {
  if (!present.length) return "";
  const names = present.map((c) => c.name);
  const blocks = present
    .map((c) =>
      formatRelationshipsForPrompt(c, {
        ...opts,
        presentNames: names,
        ownerName: c.name,
      }),
    )
    .filter(Boolean);
  if (!blocks.length) {
    return opts.zh === false
      ? "(No directed relationships extracted among present cast.)"
      : "（在场角色之间尚无已抽取的有向关系。）";
  }
  const title =
    opts.zh === false
      ? "## Present cast relationships (directed)"
      : "## 在场人物关系（有向）";
  return `${title}\n\n${blocks.join("\n\n")}`;
}

/** One-line map value for Codex relationshipStates. */
export function formatRelationshipStateValue(
  r: Relationship,
  zh: boolean,
): string {
  const type = typeLabel(r.type, zh);
  const sym = symmetryLabel(r.symmetry, zh);
  const parts = [type];
  if (sym) parts.push(sym);
  if (r.dynamics?.trim()) parts.push(r.dynamics.trim().slice(0, 80));
  return parts.join(zh ? " · " : " | ");
}

export function buildRelationshipStateMap(
  profile: CharacterProfile,
  zh = true,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of selectEdges(profile, {
    zh,
    priority: "as_is",
    maxEdges: 20,
  })) {
    if (!r.characterName) continue;
    map[r.characterName] = formatRelationshipStateValue(r, zh);
  }
  return map;
}
