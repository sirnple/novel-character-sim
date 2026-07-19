/**
 * LLM roster gate: model decides who stays from character info cards.
 * Program only supplies features (mentions, role, brief…); no hard freq/kinship rules.
 */

import type { LLMProvider } from "@/types";
import { extractJSON } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import type { NameAggregate } from "./character-name-aggregate";
import type { ResolvedEntity } from "./character-entity-types";

function norm(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

export interface RosterCandidateCard {
  name: string;
  aliases: string[];
  role: string;
  brief: string;
  mentions: number;
  unitHits: number;
  surfaces: string[];
}

export interface RosterGateLlmResult {
  kept: NameAggregate[];
  dropped: NameAggregate[];
  /** name → model reason */
  reasons: Record<string, string>;
  /** true if model call failed and we kept everyone */
  fallbackAll: boolean;
}

const GATE_SCHEMA = {
  name: "roster_gate_decision",
  description:
    "Decide which character candidates to keep for full profile extraction",
  parameters: {
    type: "object",
    properties: {
      keep: {
        type: "array",
        description: "Characters to keep (exact name from the candidate list)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact name from candidates" },
            reason: {
              type: "string",
              description: "Short reason in Chinese",
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["keep"],
  },
};

export function buildRosterCandidateCards(
  entities: ResolvedEntity[],
  counted: NameAggregate[],
): RosterCandidateCard[] {
  const countBy = new Map(counted.map((c) => [norm(c.name), c]));
  const cards: RosterCandidateCard[] = [];
  for (const e of entities) {
    const name = (e.name || "").trim();
    if (!name) continue;
    const agg = countBy.get(norm(name));
    cards.push({
      name,
      aliases: e.aliases || [],
      role: e.role || "supporting",
      brief: (e.briefDescription || "").slice(0, 200),
      mentions: agg?.mentions ?? 1,
      unitHits: agg?.unitHits ?? 1,
      surfaces: (e.surfaces || []).slice(0, 12),
    });
  }
  cards.sort((a, b) => b.mentions - a.mentions || b.unitHits - a.unitHits);
  return cards;
}

function aggFor(
  name: string,
  countBy: Map<string, NameAggregate>,
  card?: RosterCandidateCard,
): NameAggregate {
  const a = countBy.get(norm(name));
  if (a) return a;
  return {
    name,
    mentions: card?.mentions ?? 1,
    unitHits: card?.unitHits ?? 1,
    aliases: card?.aliases || [],
    firstUnit: 0,
    lastUnit: 0,
  };
}

/**
 * Ask the model who to keep. Mentions/roles/briefs are hints only.
 * On failure: keep all candidates (never silently frequency-drop).
 */
export async function gateRosterWithLlm(
  llm: LLMProvider,
  entities: ResolvedEntity[],
  counted: NameAggregate[],
  opts: {
    textLength: number;
    unitCount: number;
    /** Cap cards sent to model (token safety); default 150 */
    maxCards?: number;
  },
): Promise<RosterGateLlmResult> {
  const allCards = buildRosterCandidateCards(entities, counted);
  if (!allCards.length) {
    return { kept: [], dropped: [], reasons: {}, fallbackAll: false };
  }

  const maxCards = opts.maxCards ?? 150;
  const cards = allCards.slice(0, maxCards);
  const countBy = new Map(counted.map((c) => [norm(c.name), c]));
  const cardByNorm = new Map(cards.map((c) => [norm(c.name), c]));

  const system = resolveAgentSystem("character_roster_gate", "zh", {
    candidatesJson: JSON.stringify(cards, null, 2),
    textLength: String(opts.textLength),
    unitCount: String(opts.unitCount),
    candidateCount: String(cards.length),
  });

  const fallbackKeepAll = (why: string): RosterGateLlmResult => {
    console.warn(`[roster-gate] ${why} — retaining all candidates`);
    const reasons: Record<string, string> = {};
    for (const c of cards) reasons[c.name] = "fallback:keep_all";
    return {
      kept: cards.map((c) => aggFor(c.name, countBy, c)),
      dropped: allCards.slice(maxCards).map((c) => aggFor(c.name, countBy, c)),
      reasons,
      fallbackAll: true,
    };
  };

  let keepList: { name: string; reason?: string }[] = [];
  try {
    try {
      const result = await llm.chatWithTool<{
        keep: { name: string; reason?: string }[];
      }>(
        [
          { role: "system", content: system },
          {
            role: "user",
            content:
              "根据角色信息卡筛选进入人设/关系分析的名单。keep[].name 必须与候选人 name 完全一致。",
          },
        ],
        GATE_SCHEMA,
        { temperature: 0.2, maxTokens: 8192 },
      );
      keepList = result?.keep || [];
    } catch (e) {
      console.warn(
        "[roster-gate] chatWithTool failed, plain chat:",
        (e as Error).message,
      );
      const raw = await llm.chat(
        [
          { role: "system", content: system },
          {
            role: "user",
            content:
              '只输出 JSON：{"keep":[{"name":"…","reason":"…"}]}。name 必须来自候选人列表。',
          },
        ],
        { temperature: 0.2, maxTokens: 8192 },
      );
      const parsed = extractJSON<{ keep?: { name: string; reason?: string }[] }>(
        raw,
      );
      keepList = parsed?.keep || [];
    }
  } catch (e) {
    return fallbackKeepAll("error: " + (e as Error).message);
  }

  if (!keepList.length) return fallbackKeepAll("empty keep list");

  const reasons: Record<string, string> = {};
  const keptNames = new Set<string>();
  for (const row of keepList) {
    const n = norm(row.name || "");
    const card = cardByNorm.get(n);
    if (!card) continue;
    keptNames.add(card.name);
    reasons[card.name] = String(row.reason || "keep").slice(0, 120);
  }

  if (!keptNames.size) return fallbackKeepAll("no valid names matched");

  const kept = cards
    .filter((c) => keptNames.has(c.name))
    .map((c) => aggFor(c.name, countBy, c));
  const dropped = [
    ...cards.filter((c) => !keptNames.has(c.name)).map((c) => aggFor(c.name, countBy, c)),
    ...allCards.slice(maxCards).map((c) => aggFor(c.name, countBy, c)),
  ];

  kept.sort((a, b) => b.mentions - a.mentions || b.unitHits - a.unitHits);
  return { kept, dropped, reasons, fallbackAll: false };
}
