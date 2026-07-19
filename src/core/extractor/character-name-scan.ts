/**
 * Flash-friendly per-unit **character mention** scan → frequency filter → roster.
 * Step 1 finds character *referents* (names, epithets, kinship labels…), not only proper names.
 * Does NOT invent personality/relationships.
 *
 * Throughput: consecutive units are packed into one LLM call under a char/unit
 * budget (default ~16k chars / 6 units), then hits are re-attributed per unit.
 */

import type { LLMProvider } from "@/types";
import { extractJSON } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";
import {
  buildNameScanUnits,
  packUnitsForMentionScan,
  type TextUnit,
} from "./character-name-units";
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
    "Specific character mentions only: proper names, nicknames, stable third-person " +
    "kinship/role/epithets (e.g. 周屿的母亲, 短发大叔). " +
    "Do NOT include bare pronouns (他/她/它) or deictic kinship (他爸/他妈) as-is.",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        description:
          "One surface per specific person across the whole passage. Prefer stable third-person labels. " +
          "Exclude 他/她/它/他爸/我爸/有人 etc. Deduplicate same person.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Proper name OR stable referent (周屿的母亲/短发大叔). " +
                "Never bare 他/她/它 or 他爸 alone.",
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

function normalizeHits(
  characters: { name: string; aliases?: string[] }[] | undefined,
): UnitNameHit[] {
  return (characters || [])
    .map((c) => ({
      name: (c.name || "").trim(),
      aliases: (c.aliases || []).map((a) => String(a).trim()).filter(Boolean),
      count: 1 as const,
    }))
    .filter((c) => c.name.length >= 1 && c.name.length <= 24);
}

/** Build labeled multi-section body for one LLM call. */
export function formatMentionScanBatchText(
  batch: TextUnit[],
  maxBodyChars: number,
): { label: string; text: string } {
  if (batch.length === 1) {
    const u = batch[0];
    return {
      label: u.label,
      text: (u.text || "").slice(0, maxBodyChars),
    };
  }
  const parts: string[] = [];
  let used = 0;
  for (const u of batch) {
    const header = `\n\n### ${u.label}\n`;
    const room = maxBodyChars - used - header.length;
    if (room <= 200) break;
    const body = (u.text || "").slice(0, room);
    parts.push(header + body);
    used += header.length + body.length;
  }
  const labels = batch.map((u) => u.label);
  const label =
    labels.length <= 3
      ? labels.join(" + ")
      : `${labels[0]}…${labels[labels.length - 1]}（${labels.length}段）`;
  return { label, text: parts.join("").trim() };
}

/**
 * Attribute batch-level surfaces back to each unit by literal presence.
 * Preserves unitHits / frequency semantics after multi-unit packing.
 */
export function distributeHitsToUnits(
  batch: TextUnit[],
  hits: UnitNameHit[],
): UnitNameHit[][] {
  return batch.map((unit) => {
    const text = unit.text || "";
    const out: UnitNameHit[] = [];
    for (const h of hits) {
      const names = [h.name, ...(h.aliases || [])].filter(Boolean);
      if (names.some((n) => n && text.includes(n))) {
        out.push({
          name: h.name,
          aliases: (h.aliases || []).filter((a) => a && text.includes(a)),
          count: 1,
        });
      }
    }
    return out;
  });
}

async function extractNamesInBatch(
  llm: LLMProvider,
  batch: TextUnit[],
  zh: boolean,
  maxBodyChars: number,
): Promise<UnitNameHit[]> {
  const { label, text } = formatMentionScanBatchText(batch, maxBodyChars);
  const prompt = resolveAgentSystem("character_names_unit", zh ? "zh" : "en", {
    unitLabel: label,
    unitText: text,
  });

  try {
    const result = await llm.chatWithTool<{
      characters: { name: string; aliases?: string[] }[];
    }>([{ role: "user", content: prompt }], UNIT_NAME_SCHEMA, {
      temperature: 0.2,
      maxTokens: 8192,
    });
    return normalizeHits(result.characters);
  } catch (e) {
    console.warn(
      `[NameScan] batch ${label} tool failed:`,
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
      return normalizeHits(parsed?.characters);
    } catch {
      return [];
    }
  }
}

/**
 * LLM-only per-unit name/surface extraction (product path).
 * Packs consecutive units into fewer LLM calls under char/unit budget.
 */
export async function scanUnitHitsWithLlm(
  llm: LLMProvider,
  fullText: string,
  options: {
    units?: TextUnit[];
    zh?: boolean;
    concurrency?: number;
    /** Max novel chars per LLM call body (default ~16k / env) */
    batchChars?: number;
    /** Max units per LLM call (default 6 / env) */
    batchUnits?: number;
    onProgress?: (done: number, total: number, label: string) => void;
  } = {},
): Promise<{ units: TextUnit[]; unitHits: UnitNameHit[][] }> {
  const zh = options.zh !== false;
  const envC = Number(process.env.CHARACTER_MENTION_CONCURRENCY || "");
  const concurrency =
    options.concurrency ??
    (Number.isFinite(envC) && envC >= 1 ? Math.floor(envC) : 4);
  const units =
    options.units?.length ? options.units : buildNameScanUnits(fullText);

  const batches = packUnitsForMentionScan(units, {
    maxChars: options.batchChars,
    maxUnits: options.batchUnits,
  });

  // Body budget ≈ pack budget (section headers already reserved in packer slack)
  const envBody = Number(process.env.CHARACTER_MENTION_BATCH_CHARS || "");
  const maxBodyChars =
    options.batchChars ??
    (Number.isFinite(envBody) && envBody >= 4_000
      ? Math.floor(envBody)
      : 16_000);

  console.log(
    `[MentionScan] units=${units.length} batches=${batches.length} ` +
      `textLen=${fullText.length} concurrency=${concurrency} ` +
      `batchChars≈${maxBodyChars}`,
  );

  // Index by position in the `units` array (not unit.index — callers may pass a subset)
  const posOf = new Map<TextUnit, number>();
  units.forEach((u, i) => posOf.set(u, i));
  const unitHits: UnitNameHit[][] = new Array(units.length);
  let unitsDone = 0;

  await mapPool(batches, concurrency, async (batch, bi) => {
    const hits = await extractNamesInBatch(llm, batch, zh, maxBodyChars);
    const distributed = distributeHitsToUnits(batch, hits);
    for (let j = 0; j < batch.length; j++) {
      const pos = posOf.get(batch[j]);
      if (pos != null) unitHits[pos] = distributed[j];
    }
    unitsDone += batch.length;
    const label =
      batch.length === 1
        ? batch[0].label
        : `${batch[0].label}…×${batch.length}`;
    options.onProgress?.(unitsDone, units.length, label);
    if (bi === 0 || bi === batches.length - 1 || (bi + 1) % 5 === 0) {
      console.log(
        `[MentionScan] batch ${bi + 1}/${batches.length} (${label}): ` +
          `${hits.map((h) => h.name).join("、") || "—"} → split ${batch.length} units`,
      );
    }
    return distributed;
  });

  // Safety: any hole → empty list
  for (let i = 0; i < unitHits.length; i++) {
    if (!unitHits[i]) unitHits[i] = [];
  }

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
