/**
 * Flash-friendly per-unit character name scan → frequency filter → roster.
 * Does NOT invent personality/relationships; names (+ light aliases) only.
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
  name: "unit_character_names",
  description: "Names of characters that appear in this passage",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Character name as written" },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Other forms used in this passage only",
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
      maxTokens: 2048,
    });
    return (result.characters || [])
      .map((c) => ({
        name: (c.name || "").trim(),
        aliases: (c.aliases || []).map((a) => String(a).trim()).filter(Boolean),
        count: 1,
      }))
      .filter((c) => c.name.length >= 1 && c.name.length <= 12);
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
        { temperature: 0.2, maxTokens: 2048 },
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
        .filter((c) => c.name.length >= 1);
    } catch {
      return [];
    }
  }
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
  const zh = options.zh !== false;
  const concurrency = options.concurrency ?? 4;

  const units = buildNameScanUnits(fullText);
  console.log(
    `[NameScan] ${units.length} units, textLen=${fullText.length}, concurrency=${concurrency}`,
  );

  const unitHits = await mapPool(units, concurrency, async (unit, i) => {
    const hits = await extractNamesInUnit(llm, unit, zh);
    options.onProgress?.(i + 1, units.length, unit.label);
    if ((i + 1) % 10 === 0 || i === 0 || i === units.length - 1) {
      console.log(
        `[NameScan] unit ${i + 1}/${units.length} (${unit.label}): ${hits.map((h) => h.name).join("、") || "—"}`,
      );
    }
    return hits;
  });

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
