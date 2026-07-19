/**
 * Flash-friendly per-unit **character mention** scan → frequency filter → roster.
 * Step 1 finds character *referents* (names, epithets, kinship labels…), not only proper names.
 * Does NOT invent personality/relationships.
 */

import type { LLMProvider } from "@/types";
import { extractJSON } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import { buildNameScanUnits, type TextUnit } from "./character-name-units";
import {
  aggregateUnitHits,
  filterByMentionFrequency,
  formatFrequencyRosterForPrompt,
  type NameAggregate,
  type UnitNameHit,
  type FilterByFrequencyResult,
} from "./character-name-aggregate";

const UNIT_NAME_SCHEMA = {
  name: "unit_character_mentions",
  description:
    "All character-referring mentions in this passage (proper names, nicknames, " +
    "kinship/role labels, descriptive epithets). Not limited to people with formal names.",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        description:
          "Each entry is one surface form for a specific person in this unit. " +
          "If they have no proper name, use the referent string (e.g. 周屿的母亲, 短发大叔).",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Surface as written: proper name OR stable referent (外号/亲属/描述称呼). Do not invent names.",
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Other surfaces for the same person in this passage only",
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["characters"],
  },
};

export interface NameScanResult {
  units: TextUnit[];
  aggregates: NameAggregate[];
  filter: FilterByFrequencyResult;
  /** Prompt block for Pass1 merge */
  rosterPrompt: string;
  stats: {
    unitCount: number;
    rawNameCount: number;
    keptCount: number;
    threshold: { minMentions: number; minUnits: number };
    thresholdRaised: boolean;
    ms: number;
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function extractNamesInUnit(
  llm: LLMProvider,
  unit: TextUnit,
  zh: boolean,
): Promise<UnitNameHit[]> {
  const prompt = resolveAgentSystem("character_names_unit", zh ? "zh" : "en", {
    unitLabel: unit.label,
    unitText: unit.text.slice(0, 14_000),
  });

  try {
    const result = await llm.chatWithTool<{
      characters: { name: string; aliases?: string[] }[];
    }>([{ role: "user", content: prompt }], UNIT_NAME_SCHEMA, {
      temperature: 0.2,
      maxTokens: 8192,
    });
    return (result.characters || [])
      .map((c) => ({
        name: (c.name || "").trim(),
        aliases: (c.aliases || []).map((a) => String(a).trim()).filter(Boolean),
        count: 1,
      }))
      // Allow longer kinship/descriptive referents e.g. 「周屿和周航的母亲」
      .filter((c) => c.name.length >= 1 && c.name.length <= 24);
  } catch (e) {
    // Fallback: plain-text JSON if tool path fails
    console.warn(
      `[NameScan] unit ${unit.index} tool failed:`,
      (e as Error).message,
    );
    try {
      const raw = await llm.chat(
        [
          {
            role: "user",
            content:
              prompt +
              '\n\n只输出 JSON：{"characters":[{"name":"...","aliases":[]}]}',
          },
        ],
        { temperature: 0.2, maxTokens: 8192 },
      );
      const parsed = extractJSON<{
        characters?: { name: string; aliases?: string[] }[];
      }>(raw);
      return (parsed?.characters || [])
        .map((c) => ({
          name: (c.name || "").trim(),
          aliases: c.aliases || [],
          count: 1,
        }))
        .filter((c) => c.name.length >= 1 && c.name.length <= 24);
    } catch {
      return [];
    }
  }
}

/**
 * LLM-only per-unit name/surface extraction (product path).
 * Does NOT use programmatic surname heuristics.
 */
export async function scanUnitHitsWithLlm(
  llm: LLMProvider,
  fullText: string,
  options: {
    units?: TextUnit[];
    zh?: boolean;
    concurrency?: number;
    onProgress?: (done: number, total: number, label: string) => void;
  } = {},
): Promise<{ units: TextUnit[]; unitHits: UnitNameHit[][] }> {
  const zh = options.zh !== false;
  // Default 4 everywhere (dev + prod). Override: CHARACTER_MENTION_CONCURRENCY
  const envC = Number(process.env.CHARACTER_MENTION_CONCURRENCY || "");
  const concurrency =
    options.concurrency ??
    (Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4);
  const units =
    options.units?.length ? options.units : buildNameScanUnits(fullText);

  console.log(
    `[MentionScan] units=${units.length} textLen=${fullText.length} concurrency=${concurrency}`,
  );

  const unitHits = await mapPool(units, concurrency, async (unit, i) => {
    const hits = await extractNamesInUnit(llm, unit, zh);
    options.onProgress?.(i + 1, units.length, unit.label);
    if ((i + 1) % 10 === 0 || i === 0 || i === units.length - 1) {
      console.log(
        `[MentionScan] unit ${i + 1}/${units.length} (${unit.label}): ${hits.map((h) => h.name).join("、") || "—"}`,
      );
    }
    return hits;
  });

  return { units, unitHits };
}

/**
 * Scan the whole novel unit-by-unit for names, then keep by frequency threshold.
 */
export async function scanNamesByUnits(
  llm: LLMProvider,
  fullText: string,
  options: {
    zh?: boolean;
    concurrency?: number;
    onProgress?: (done: number, total: number, label: string) => void;
  } = {},
): Promise<NameScanResult> {
  const t0 = Date.now();
  const { units, unitHits } = await scanUnitHitsWithLlm(llm, fullText, options);

  const aggregates = aggregateUnitHits(unitHits);
  const filter = filterByMentionFrequency(aggregates, {
    textLength: fullText.length,
    unitCount: units.length,
    // Soft prompt safety only; still frequency ladder, not top-80
    softMaxNames: 200,
  });

  const rosterPrompt = formatFrequencyRosterForPrompt(filter.kept);

  console.log(
    `[NameScan] done: rawNames=${aggregates.length} kept=${filter.kept.length} ` +
      `threshold=mentions≥${filter.threshold.minMentions}/units≥${filter.threshold.minUnits}` +
      `${filter.thresholdRaised ? " (raised)" : ""} ${Date.now() - t0}ms`,
  );

  return {
    units,
    aggregates,
    filter,
    rosterPrompt,
    stats: {
      unitCount: units.length,
      rawNameCount: aggregates.length,
      keptCount: filter.kept.length,
      threshold: filter.threshold,
      thresholdRaised: filter.thresholdRaised,
      ms: Date.now() - t0,
    },
  };
}
