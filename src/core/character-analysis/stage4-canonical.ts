/**
 * Stage ④: pick a **canonicalName** from each entity's surfaces for roster submit.
 *
 * Flow:
 * 1. **Program rules** first (always produce a candidate + confidence).
 * 2. **Confident** picks skip LLM (e.g. exactly one `proper`, clear score lead).
 * 3. **Uncertain** only → optional LLM among top surfaces; else keep rule pick.
 */

import type { LLMProvider, ToolSchema } from "@/types";
import {
  isBarePronounOrGeneric,
  isInvalidUnitPrimaryName,
  isUnanchoredRelationLabel,
} from "@/core/extractor/character-entity-types";
import { isDeicticPronounSurface } from "./coref/features";
import {
  isProperKind,
  resolveMentionKind,
  type MentionKind,
} from "./mention-kind";
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
  /**
   * True when rule pick is trusted enough to skip LLM.
   * False → caller may ask LLM; still always has a rule fallback name.
   */
  ruleConfident: boolean;
}

function surfaceCounts(c: MergedCharacter): Map<string, number> {
  const m = new Map<string, number>();
  for (const ment of c.mentions || []) {
    const s = normalizeMentionSurface(ment.surface);
    if (!s) continue;
    m.set(s, (m.get(s) || 0) + 1);
  }
  return m;
}

/** Distinct surfaces whose kind is proper (LLM/rule kind on mentions). */
export function uniqueProperSurfaces(c: MergedCharacter): string[] {
  const set = new Set<string>();
  for (const ment of c.mentions || []) {
    const s = normalizeMentionSurface(ment.surface);
    if (!s) continue;
    const k: MentionKind = ment.kind ?? resolveMentionKind(s, ment.kind);
    if (isProperKind(k)) set.add(s);
  }
  return Array.from(set);
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

  const hasLongerSuperstring = allSurfaces.some((o) => {
    const t = normalizeMentionSurface(o);
    return t !== s && t.includes(s) && t.length > s.length && looksPersonalName(t);
  });
  if (hasLongerSuperstring) {
    score -= 3;
    flags.push("has-longer-form");
  }
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
 * Decide if the rule pick is confident enough to skip LLM.
 */
export function isRuleConfidentCanonical(
  c: MergedCharacter,
  ranked: SurfaceScoreRow[],
  scoreGapForLlm: number,
): { confident: boolean; reason: string } {
  const propers = uniqueProperSurfaces(c);
  if (propers.length === 1) {
    return {
      confident: true,
      reason: `single-proper「${propers[0]}」`,
    };
  }

  const viable = ranked.filter((r) => r.score > -1e5);
  if (viable.length === 0) {
    // only deictics / empty — still skip LLM (nothing good to ask)
    return { confident: true, reason: "no-viable-surface" };
  }
  if (viable.length === 1) {
    return {
      confident: true,
      reason: `single-viable「${viable[0]!.surface}」`,
    };
  }

  // Clear score winner
  if (viable[0]!.score - viable[1]!.score > scoreGapForLlm) {
    return {
      confident: true,
      reason: `score-lead Δ=${(viable[0]!.score - viable[1]!.score).toFixed(1)}`,
    };
  }

  // Multiple propers or close scores → LLM
  if (propers.length >= 2) {
    return {
      confident: false,
      reason: `multi-proper(${propers.join("、")})`,
    };
  }

  return {
    confident: false,
    reason: `close-scores top=${viable[0]!.surface}/${viable[1]!.surface}`,
  };
}

/**
 * Pure rule-based canonical pick (no LLM). Always sets canonicalName.
 */
export function selectCanonicalName(
  c: MergedCharacter,
  opts?: { scoreGapForLlm?: number },
): CanonicalPick {
  const gap = opts?.scoreGapForLlm ?? 3;
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
      ruleConfident: true,
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

  // Prefer single proper when present (even if frequency lower than a title)
  const propers = uniqueProperSurfaces(c);
  let best: SurfaceScoreRow | undefined;
  let forceReason: string | undefined;
  if (propers.length === 1) {
    const p = propers[0]!;
    best = ranked.find((r) => r.surface === p) || {
      surface: p,
      count: counts.get(p) || 1,
      score: 999,
      flags: ["single-proper"],
    };
    forceReason = `single-proper「${p}」`;
  } else {
    best =
      ranked.find((r) => r.score > -1e5) ||
      ranked[0] || {
        surface: surfaces[0]!,
        count: 1,
        score: 0,
        flags: [],
      };
  }

  const conf = isRuleConfidentCanonical(c, ranked, gap);
  const canonicalName = best.surface || "未知";
  const aliases = surfaces.filter((s) => s !== canonicalName);
  const reason =
    forceReason ||
    `score=${best.score.toFixed(1)} flags=${best.flags.join(",") || "—"} ` +
      `among ${surfaces.length} surfaces`;

  return {
    canonicalName,
    aliases,
    surfaces,
    reason: conf.confident
      ? `rule-confident(${conf.reason}): ${reason}`
      : `rule-uncertain(${conf.reason}): ${reason}`,
    ranked,
    ruleConfident: conf.confident,
  };
}

/** Attach canonicalName on each character (rules only). */
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
 * Rules first; LLM only when `ruleConfident` is false.
 */
export async function selectCanonicalNameWithOptionalLlm(
  c: MergedCharacter,
  llm: LLMProvider | null | undefined,
  opts?: { scoreGapForLlm?: number },
): Promise<CanonicalPick> {
  const base = selectCanonicalName(c, opts);
  if (base.ruleConfident || !llm) return base;

  const top = base.ranked.filter((r) => r.score > -1e5);
  const candidates =
    top.length >= 2
      ? top.slice(0, 6).map((r) => r.surface)
      : base.surfaces.slice(0, 6);
  if (candidates.length < 2) return { ...base, ruleConfident: true };

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
                candidates.map((s) => {
                  const row = base.ranked.find((r) => r.surface === s);
                  return [s, row?.count ?? 0];
                }),
              ),
            )}`,
            c.gender ? `gender=${c.gender}` : "",
            c.age ? `age=${c.age}` : "",
            `ruleFallback=${base.canonicalName}`,
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
        reason: `llm: ${raw?.reason || "uncertain-rule"} (rule was ${base.canonicalName})`,
        ranked: base.ranked,
        ruleConfident: false,
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
  const concurrency = Math.max(1, Math.min(32, opts?.concurrency ?? 6));
  const out = new Array<MergedCharacter>(characters.length);

  // Pass 1: rules for everyone
  const picks = characters.map((c) => selectCanonicalName(c, opts));
  const needLlm: number[] = [];
  for (let i = 0; i < characters.length; i++) {
    const pick = picks[i]!;
    if (pick.ruleConfident || !llm) {
      out[i] = { ...characters[i]!, canonicalName: pick.canonicalName };
      opts?.onDone?.(i + 1, characters.length, pick.canonicalName);
    } else {
      needLlm.push(i);
    }
  }

  if (!llm || needLlm.length === 0) {
    return out.map((c, i) => c ?? { ...characters[i]!, canonicalName: picks[i]!.canonicalName });
  }

  // Pass 2: LLM only for uncertain
  let cursor = 0;
  async function worker() {
    while (cursor < needLlm.length) {
      const k = cursor++;
      const i = needLlm[k]!;
      const c = characters[i]!;
      const pick = await selectCanonicalNameWithOptionalLlm(c, llm, {
        scoreGapForLlm: opts?.scoreGapForLlm,
      });
      out[i] = { ...c, canonicalName: pick.canonicalName };
      opts?.onDone?.(i + 1, characters.length, pick.canonicalName);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, needLlm.length) },
      () => worker(),
    ),
  );

  return out;
}
