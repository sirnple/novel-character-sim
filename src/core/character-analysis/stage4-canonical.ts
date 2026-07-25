/**
 * Stage ④: pick a **canonicalName** from each entity's surfaces for roster submit.
 *
 * Rules prefer: non-deictic, name-like, high mention frequency, stable personal names
 * over pure kinship/title when alternatives exist.
 * Optional LLM tie-break when top candidates are close.
 */

import type { LLMProvider, ToolSchema } from "@/types";
import {
  isBarePronounOrGeneric,
  isInvalidUnitPrimaryName,
  isUnanchoredRelationLabel,
} from "@/core/extractor/character-entity-types";
import { isDeicticPronounSurface } from "./coref/features";
import {
  normalizeMentionSurface,
  type MergedCharacter,
} from "./merge-adjacent";

export interface SurfaceScoreRow {
  surface: string;
  count: number;
  score: number;
  flags: string[];
}

export interface CanonicalPick {
  canonicalName: string;
  /** All other non-empty surfaces (including deictics) except canonical */
  aliases: string[];
  surfaces: string[];
  reason: string;
  ranked: SurfaceScoreRow[];
}

function surfaceCounts(c: MergedCharacter): Map<string, number> {
  const m = new Map<string, number>();
  for (const ment of c.mentions || []) {
    const s = normalizeMentionSurface(ment.surface);
    if (!s) continue;
    m.set(s, (m.get(s) || 0) + 1);
  }
  // Also include any surface that only appears as unique set member
  for (const s of m.keys()) {
    /* already counted */
  }
  return m;
}

function looksPersonalName(s: string): boolean {
  const t = s.replace(/\s+/g, "");
  if (t.length < 2 || t.length > 6) return false;
  if (!/^[\u4e00-\u9fff·•]+$/.test(t)) return false;
  if (/[的之了着过]/.test(t)) return false;
  if (isUnanchoredRelationLabel(t) || isInvalidUnitPrimaryName(t)) return false;
  if (/(老师|博士|将军|少将|执政官|机长|官员|阿姨|保姆)$/.test(t)) return false;
  return true;
}

function isTitleHeavy(s: string): boolean {
  const t = s.replace(/\s+/g, "");
  return (
    /(老师|博士|将军|少将|执政官|机长|官员|阿姨|保姆|同学|总|经理|主任)$/.test(
      t,
    ) || isUnanchoredRelationLabel(t)
  );
}

/** Score one surface as canonical candidate (higher = better). */
export function scoreSurfaceAsCanonical(
  surface: string,
  count: number,
  allSurfaces: string[],
): SurfaceScoreRow {
  const s = normalizeMentionSurface(surface);
  const flags: string[] = [];
  let score = 0;

  if (!s) {
    return { surface: s, count, score: -1e9, flags: ["empty"] };
  }
  if (isDeicticPronounSurface(s) || isBarePronounOrGeneric(s)) {
    return { surface: s, count, score: -1e6, flags: ["deictic"] };
  }

  score += count * 4;
  flags.push(`count=${count}`);

  // Prefer moderate length personal names; slight bonus for longer full names
  const len = s.replace(/\s+/g, "").length;
  score += Math.min(len, 6) * 0.8;

  if (looksPersonalName(s)) {
    score += 8;
    flags.push("personal");
  }
  if (isTitleHeavy(s)) {
    score -= 4;
    flags.push("title/relation");
  }
  if (isInvalidUnitPrimaryName(s)) {
    score -= 12;
    flags.push("invalid-primary");
  }

  // If a shorter form is contained in a longer personal-looking surface, prefer longer
  const hasLongerSuperstring = allSurfaces.some((o) => {
    const t = normalizeMentionSurface(o);
    return t !== s && t.includes(s) && t.length > s.length && looksPersonalName(t);
  });
  if (hasLongerSuperstring) {
    score -= 3;
    flags.push("has-longer-form");
  }
  // Contained full name: bonus for being the longer form
  const isLongerForm = allSurfaces.some((o) => {
    const t = normalizeMentionSurface(o);
    return t !== s && s.includes(t) && s.length > t.length && t.length >= 2;
  });
  if (isLongerForm && looksPersonalName(s)) {
    score += 3;
    flags.push("fuller-form");
  }

  return { surface: s, count, score, flags };
}

/**
 * Pure rule-based canonical pick (no LLM).
 */
export function selectCanonicalName(c: MergedCharacter): CanonicalPick {
  const counts = surfaceCounts(c);
  const surfaces = Array.from(
    new Set(
      [
        ...counts.keys(),
        ...(c.mentions || []).map((m) => normalizeMentionSurface(m.surface)),
      ].filter(Boolean),
    ),
  );
  if (!surfaces.length) {
    return {
      canonicalName: "未知",
      aliases: [],
      surfaces: [],
      reason: "no surfaces",
      ranked: [],
    };
  }

  const ranked = surfaces
    .map((s) => scoreSurfaceAsCanonical(s, counts.get(s) || 0, surfaces))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.count - a.count ||
        b.surface.length - a.surface.length ||
        a.surface.localeCompare(b.surface, "zh"),
    );

  // Prefer best non-deictic; if all deictic, fall back to most frequent surface
  const best =
    ranked.find((r) => r.score > -1e5) ||
    ranked[0] || {
      surface: surfaces[0]!,
      count: 1,
      score: 0,
      flags: [],
    };

  const canonicalName = best.surface || "未知";
  const aliases = surfaces.filter((s) => s !== canonicalName);
  const reason =
    `score=${best.score.toFixed(1)} flags=${best.flags.join(",") || "—"} ` +
    `among ${surfaces.length} surfaces`;

  return {
    canonicalName,
    aliases,
    surfaces,
    reason,
    ranked,
  };
}

/** Attach canonicalName on each character (mutates copy). */
export function applyStage4CanonicalNames(
  characters: MergedCharacter[],
): MergedCharacter[] {
  return characters.map((c) => {
    const pick = selectCanonicalName(c);
    return {
      ...c,
      canonicalName: pick.canonicalName,
    };
  });
}

const CANONICAL_TOOL: ToolSchema = {
  name: "pick_canonical_name",
  description: "Pick the best display/canonical name from surface list",
  parameters: {
    type: "object",
    properties: {
      canonicalName: {
        type: "string",
        description: "Must be exactly one of the provided surfaces",
      },
      reason: { type: "string" },
    },
    required: ["canonicalName"],
  },
};

/**
 * When top-2 rule scores are close, ask LLM to pick among candidates.
 * Falls back to rules on any failure / invalid pick.
 */
export async function selectCanonicalNameWithOptionalLlm(
  c: MergedCharacter,
  llm: LLMProvider | null | undefined,
  opts?: { scoreGapForLlm?: number },
): Promise<CanonicalPick> {
  const base = selectCanonicalName(c);
  if (!llm || base.ranked.length < 2) return base;

  const gap = opts?.scoreGapForLlm ?? 3;
  const top = base.ranked.filter((r) => r.score > -1e5);
  if (top.length < 2) return base;
  if (top[0]!.score - top[1]!.score > gap) return base;

  const candidates = top.slice(0, 6).map((r) => r.surface);
  try {
    const raw = await llm.chatWithTool<{
      canonicalName?: string;
      reason?: string;
    }>(
      [
        {
          role: "user",
          content: [
            "从下列 surface 中选出最适合作为角色名单【canonicalName / 主名】的一个。",
            "要求：优先真实姓名/稳定第三人称称谓；不要选 我/你/他 等代词；不要选纯关系词（爸爸/妈妈）若有更好选择。",
            "必须原样返回列表中的某一项。",
            "",
            `候选: ${JSON.stringify(candidates)}`,
            `频次: ${JSON.stringify(
              Object.fromEntries(
                top.slice(0, 6).map((r) => [r.surface, r.count]),
              ),
            )}`,
            c.gender ? `gender=${c.gender}` : "",
            c.age ? `age=${c.age}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      CANONICAL_TOOL,
      { temperature: 0.1, maxTokens: 2000 },
    );
    const pick = normalizeMentionSurface(raw?.canonicalName || "");
    if (pick && candidates.includes(pick)) {
      return {
        canonicalName: pick,
        aliases: base.surfaces.filter((s) => s !== pick),
        surfaces: base.surfaces,
        reason: `llm: ${raw?.reason || "tie-break"} (rule was ${base.canonicalName})`,
        ranked: base.ranked,
      };
    }
  } catch {
    /* fall back */
  }
  return base;
}

export async function applyStage4CanonicalNamesWithLlm(
  characters: MergedCharacter[],
  llm: LLMProvider | null | undefined,
  opts?: {
    concurrency?: number;
    scoreGapForLlm?: number;
    onDone?: (i: number, total: number, name: string) => void;
  },
): Promise<MergedCharacter[]> {
  const concurrency = Math.max(1, Math.min(16, opts?.concurrency ?? 6));
  const out = new Array<MergedCharacter>(characters.length);
  let next = 0;

  async function worker() {
    while (next < characters.length) {
      const i = next++;
      const c = characters[i]!;
      const pick = await selectCanonicalNameWithOptionalLlm(c, llm, {
        scoreGapForLlm: opts?.scoreGapForLlm,
      });
      out[i] = { ...c, canonicalName: pick.canonicalName };
      opts?.onDone?.(i + 1, characters.length, pick.canonicalName);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, characters.length || 1) }, () =>
      worker(),
    ),
  );
  return out;
}
