/**
 * Re-run Stage ② + ③ from a previous eval's stage1 `byWindow` (no stage1 LLM).
 *
 *   npx tsx scripts/eval/run-stage2-3-from-stage1.ts --concurrency=30 \
 *     scripts/eval/results/char-s1-欲孽灼心_主线-2026-07-26T09-38-09
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { loadEnvLocal } from "../lib/load-env-local";

function loadEnvFiles() {
  const cwd = process.cwd();
  const preset = new Set(
    Object.keys(process.env).filter(
      (k) => process.env[k] !== undefined && process.env[k] !== "",
    ),
  );
  for (const name of [".env", ".env.local"]) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf-8");
    for (const line of text.split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (preset.has(key)) continue;
      process.env[key] = val;
    }
  }
  loadEnvLocal(cwd);
}

loadEnvFiles();
if (!process.env.LLM_SAVE_COT) process.env.LLM_SAVE_COT = "1";

import { createLLMProvider } from "../../src/core/llm/factory";
import {
  buildAnalysisWindows,
  mergeAdjacentWindowCharacters,
  resolveCorefWithRulesAndAgent,
  type AnalysisWindow,
  type Character,
  type WindowExtractResult,
} from "../../src/core/character-analysis";

function readNovelFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 5 || /Ã.|Â./.test(text.slice(0, 200))) {
    text = iconv.decode(buf, "gbk");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function parseArgs() {
  let concurrency = 30;
  let agent = true;
  let src: string | null = null;
  for (const a of process.argv.slice(2)) {
    let m: RegExpMatchArray | null;
    if ((m = a.match(/^--concurrency=(\d+)$/))) {
      concurrency = Math.max(1, Math.min(32, parseInt(m[1]!, 10)));
      continue;
    }
    if (a === "--noAgent") {
      agent = false;
      continue;
    }
    if (!a.startsWith("-")) src = a;
  }
  return { concurrency, agent, src };
}

/** Rebuild WindowExtractResult[] from saved byWindow rows. */
function byWindowToExtractResults(
  byWindow: Array<{
    index: number;
    label?: string;
    start: number;
    end: number;
    characters?: Character[];
    error?: string;
  }>,
  windows: AnalysisWindow[],
): WindowExtractResult[] {
  const byIndex = new Map(windows.map((w) => [w.index, w]));
  return byWindow
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((row) => {
      const full = byIndex.get(row.index);
      return {
        window: {
          index: row.index,
          label: row.label ?? full?.label ?? `窗${row.index}`,
          start: row.start,
          end: row.end,
        },
        characters: (row.characters || []) as Character[],
        error: row.error,
      };
    });
}

async function main() {
  const args = parseArgs();
  if (!args.src) {
    throw new Error(
      "Usage: npx tsx scripts/eval/run-stage2-3-from-stage1.ts [--concurrency=30] <runDir|result.json>",
    );
  }

  const srcPath = path.resolve(args.src);
  const resultPath = fs.statSync(srcPath).isDirectory()
    ? path.join(srcPath, "result.json")
    : srcPath;
  if (!fs.existsSync(resultPath)) throw new Error(`Missing ${resultPath}`);

  const prev = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
    title?: string;
    source?: string;
    config?: { windowChars?: number; overlapChars?: number };
    byWindow?: Array<{
      index: number;
      label?: string;
      start: number;
      end: number;
      characters?: Character[];
      error?: string;
    }>;
  };

  if (!prev.byWindow?.length) {
    throw new Error("No byWindow (stage1) in result.json");
  }

  const source = prev.source || "";
  if (!source || source.startsWith("db:") || !fs.existsSync(source)) {
    throw new Error(`Need local novel path in result.source (got ${source})`);
  }

  const text = readNovelFile(source);
  const windowChars = prev.config?.windowChars ?? 6000;
  const overlapChars = prev.config?.overlapChars ?? 800;
  const windows = buildAnalysisWindows(text, { windowChars, overlapChars });
  const byWindow = byWindowToExtractResults(prev.byWindow, windows);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = (prev.title || "novel")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .slice(0, 40);
  const runDir = path.join(
    "scripts",
    "eval",
    "results",
    `char-s23-from-s1-${slug}-${stamp}`,
  );
  const cotDir = path.join(runDir, "cot");
  fs.mkdirSync(cotDir, { recursive: true });
  process.env.LLM_COT_DIR = path.resolve(cotDir);

  console.log(`[s2+s3] from stage1 ${resultPath}`);
  console.log(
    `[s2+s3] byWindow=${byWindow.length} windows=${windows.length} concurrency=${args.concurrency}`,
  );
  console.log(`[s2+s3] runDir=${runDir}`);

  // ── Stage ② ─────────────────────────────────────────────
  const t0 = Date.now();
  const s2 = mergeAdjacentWindowCharacters(byWindow, windows);
  const mergeHit = s2.traces.reduce((n, t) => n + t.merges.length, 0);
  console.log(
    `[stage2] characters=${s2.characters.length} pairLevels=${s2.traces.length} mergeEdges=${mergeHit}`,
  );

  // ── Stage ③ ─────────────────────────────────────────────
  const llm = createLLMProvider("analysis");
  console.log(
    `\n[stage3] coref` +
      (args.agent ? "+agent" : " (no agent)") +
      ` pairs≈C(${s2.characters.length},2)`,
  );
  const stage3Result = await resolveCorefWithRulesAndAgent(
    s2.characters,
    windows,
    {
      llm: args.agent ? llm : null,
      agentConcurrency: args.concurrency,
      fullText: text,
      agentContextRadius: 220,
      config: {
        agentEnabled: args.agent,
        agentConcurrency: args.concurrency,
      },
      onAgentPair: (info) => {
        const phase = info.phase === "same_surface" ? "surface" : "grey";
        const mode = info.llmMode ? `/${info.llmMode}` : "";
        process.stdout.write(
          `\r[stage3] ${phase}${mode} ${info.index + 1}/${info.total} ${info.idA}~${info.idB} score=${info.score.toFixed(2)}   `,
        );
      },
    },
  );
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\n[stage3] done ${s2.characters.length} → ${stage3Result.characters.length} ` +
      `autoMerge=${stage3Result.stats.autoMerge} autoReject=${stage3Result.stats.autoReject} ` +
      `agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep} ` +
      `agentMerge=${stage3Result.stats.agentMerge} ${elapsed}s`,
  );

  const payload = {
    stage: "2+3-from-s1",
    ranAt: new Date().toISOString(),
    sourceStage1: resultPath,
    title: prev.title,
    source,
    textLength: text.length,
    config: { windowChars, overlapChars },
    windowCount: windows.length,
    elapsedSec: elapsed,
    runDir,
    cotDir: path.relative(process.cwd(), process.env.LLM_COT_DIR || cotDir),
    byWindow: prev.byWindow,
    stage2: {
      mode: "pairwise-hierarchical; shared proper|nick any-offset OR identical-in-overlap tiers",
      characterCount: s2.characters.length,
      pairLevels: s2.traces.length,
      mergeEdges: mergeHit,
      characters: s2.characters,
      traces: s2.traces,
    },
    stage3: {
      config: stage3Result.config,
      inputCount: stage3Result.inputCount,
      characterCount: stage3Result.characters.length,
      pairCount: stage3Result.pairCount,
      stats: stage3Result.stats,
      characters: stage3Result.characters,
      scored: stage3Result.scored.filter(
        (s) =>
          s.decision === "auto_merge" ||
          s.decision === "agent" ||
          s.decision === "agent_merge" ||
          s.decision === "agent_reject",
      ),
    },
  };

  const jsonPath = path.join(runDir, "result.json");
  const mdPath = path.join(runDir, "result.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const md: string[] = [
    `# Character analysis Stage2+3 from Stage1 — ${prev.title || ""}`,
    ``,
    `- sourceStage1: \`${resultPath}\``,
    `- source: \`${source}\``,
    `- stage1 windows: ${byWindow.length}`,
    `- **stage2 characters: ${s2.characters.length}** (pairLevels=${s2.traces.length}, mergeEdges=${mergeHit})`,
    `- **stage3 characters: ${stage3Result.characters.length}**`,
    `- elapsed: ${elapsed}s`,
    `- autoMerge=${stage3Result.stats.autoMerge} autoReject=${stage3Result.stats.autoReject}`,
    `- agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep}`,
    `- agentMerge=${stage3Result.stats.agentMerge} agentReject=${stage3Result.stats.agentReject}`,
    ``,
    `## Stage3 消解后人物列表`,
    ``,
  ];
  for (const c of stage3Result.characters) {
    const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
    md.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
        `{${surfaces.join("、")}} n=${c.mentions.length}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : ""),
    );
  }
  md.push(``, `## Stage2 全局人物列表`, ``);
  for (const c of s2.characters) {
    const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
    md.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
        `{${surfaces.join("、")}} n=${c.mentions.length}`,
    );
  }
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  console.log(`[s2+s3] wrote ${jsonPath}`);
  console.log(`[s2+s3] wrote ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
