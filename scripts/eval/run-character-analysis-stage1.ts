/**
 * Stage ① window LLM extract + ② pairwise overlap merge + optional ③ coref rules/agent.
 *
 *   npx tsx scripts/eval/run-character-analysis-stage1.ts --maxWindows=1 "C:\path\novel.txt"
 *   npx tsx scripts/eval/run-character-analysis-stage1.ts --stage1Only "C:\path\novel.txt"
 *   npx tsx scripts/eval/run-character-analysis-stage1.ts --stage3 "C:\path\novel.txt"
 *   npx tsx scripts/eval/run-character-analysis-stage1.ts --stage3 --noAgent path.txt
 *
 * Each run writes one folder (result + CoT together):
 *   scripts/eval/results/char-s1-<slug>-<stamp>/
 *     result.json
 *     result.md
 *     cot/extract_window_characters/<stamp>-wN-enabled.txt
 *     cot/coref_pair_judge/…   (when --stage3 + agent)
 *
 * CoT requires LLM_SAVE_COT=1 (default for this script).
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { loadEnvLocal } from "../lib/load-env-local";

/**
 * Load env like Next.js: `.env` then `.env.local` (later overrides earlier).
 * Shell / CI vars already set in process.env always win.
 */
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
      // shell/CI wins; among files, later overrides earlier (.env.local > .env)
      if (preset.has(key)) continue;
      process.env[key] = val;
    }
  }
  // loadEnvLocal is no-op for keys we already set from .env.local above;
  // keep call for any other scripts that only rely on it.
  loadEnvLocal(cwd);
}

loadEnvFiles();

// Default: save DeepSeek CoT for stage1 smoke runs (override with LLM_SAVE_COT=0)
if (
  process.env.LLM_SAVE_COT === undefined ||
  process.env.LLM_SAVE_COT === ""
) {
  process.env.LLM_SAVE_COT = "1";
}

import { createLLMProvider } from "../../src/core/llm/factory";
import {
  mergeAdjacentWindowCharacters,
  resolveCorefWithRulesAndAgent,
  runStage1WindowScan,
} from "../../src/core/character-analysis";
import type { Character } from "../../src/core/character-analysis";

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

function loadNovelFromDb(novelId: string): { title: string; text: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const tryPaths = [
    path.resolve(process.cwd(), "data/eval/novels.db"),
    path.resolve(process.cwd(), "data/novels.db"),
  ].filter((p) => fs.existsSync(p));
  if (!tryPaths.length) throw new Error("No data/novels.db or data/eval/novels.db");
  for (const dbPath of tryPaths) {
    const d = new Database(dbPath, { readonly: true });
    try {
      const row = d
        .prepare(
          "SELECT id, title, text FROM novels WHERE id = ? LIMIT 1",
        )
        .get(novelId) as { id: string; title: string; text: string } | undefined;
      if (row?.text?.trim()) {
        return { title: row.title || novelId, text: row.text };
      }
    } finally {
      d.close();
    }
  }
  throw new Error(`Novel ${novelId} not found or empty`);
}

function parseArgs() {
  let maxWindows: number | null = null;
  let concurrency = 2;
  let windowChars = 6000;
  let overlapChars = 800;
  let novelId: string | null = null;
  let stage3 = false;
  let stage1Only = false;
  let agent = true;
  const positional: string[] = [];
  for (const a of process.argv.slice(2)) {
    let m: RegExpMatchArray | null;
    if ((m = a.match(/^--maxWindows=(\d+)$/))) {
      maxWindows = Math.max(1, parseInt(m[1]!, 10));
      continue;
    }
    if ((m = a.match(/^--concurrency=(\d+)$/))) {
      concurrency = Math.max(1, Math.min(32, parseInt(m[1]!, 10)));
      continue;
    }
    if ((m = a.match(/^--windowChars=(\d+)$/))) {
      windowChars = Math.max(500, parseInt(m[1]!, 10));
      continue;
    }
    if ((m = a.match(/^--overlapChars=(\d+)$/))) {
      overlapChars = Math.max(0, parseInt(m[1]!, 10));
      continue;
    }
    if ((m = a.match(/^--novelId=(.+)$/))) {
      novelId = m[1]!.trim();
      continue;
    }
    if (a === "--stage3") {
      stage3 = true;
      continue;
    }
    if (a === "--stage1Only" || a === "--stage1-only") {
      stage1Only = true;
      continue;
    }
    if (a === "--noAgent") {
      agent = false;
      continue;
    }
    if (!a.startsWith("-")) positional.push(a);
  }
  return {
    filePath: positional[0] || null,
    novelId,
    maxWindows,
    concurrency,
    windowChars,
    overlapChars,
    stage3,
    stage1Only,
    agent,
  };
}

function summarize(chars: Character[]): string {
  return chars
    .map((c, i) => {
      const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
      const anchors = c.mentions
        .slice(0, 8)
        .map((m) => `${m.surface}「${m.textAnchor}」`)
        .join(", ");
      const more =
        c.mentions.length > 8 ? ` …+${c.mentions.length - 8}` : "";
      return (
        `  ${i + 1}. {${surfaces.join("、")}} n=${c.mentions.length}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : "") +
        `\n     ${anchors}${more}`
      );
    })
    .join("\n");
}

async function main() {
  const args = parseArgs();
  let title = "unknown";
  let text = "";
  let source = "";

  if (args.filePath) {
    if (!fs.existsSync(args.filePath)) {
      throw new Error(`File not found: ${args.filePath}`);
    }
    text = readNovelFile(args.filePath);
    title = path.basename(args.filePath, path.extname(args.filePath));
    source = args.filePath;
  } else if (args.novelId) {
    const n = loadNovelFromDb(args.novelId);
    title = n.title;
    text = n.text;
    source = `db:${args.novelId}`;
  } else {
    throw new Error(
      'Usage: npx tsx scripts/eval/run-character-analysis-stage1.ts [--maxWindows=1] [--novelId=ID] "path/to.txt"',
    );
  }

  console.log(`[stage1] title=${title}`);
  console.log(`[stage1] source=${source}`);
  console.log(
    `[stage1] textLen=${text.length} windowChars=${args.windowChars} ` +
      `overlap=${args.overlapChars} maxWindows=${args.maxWindows ?? "all"} ` +
      `concurrency=${args.concurrency}`,
  );

  // One folder per run: result.json/md + cot/<tool>/…
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = title.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40);
  const runDir = path.join("scripts", "eval", "results", `char-s1-${slug}-${stamp}`);
  const cotDir = path.join(runDir, "cot");
  fs.mkdirSync(cotDir, { recursive: true });
  process.env.LLM_COT_DIR = path.resolve(cotDir);
  console.log(`[stage1] runDir=${runDir}`);
  console.log(`[stage1] cotDir=${process.env.LLM_COT_DIR}`);

  const llm = createLLMProvider("analysis");
  const t0 = Date.now();
  const { config, windows, byWindow } = await runStage1WindowScan(text, llm, {
    config: {
      windowChars: args.windowChars,
      overlapChars: args.overlapChars,
    },
    maxWindows: args.maxWindows,
    concurrency: args.concurrency,
    onWindowDone: (r, i, total) => {
      const n = r.characters.length;
      const m = r.characters.reduce((s, c) => s + c.mentions.length, 0);
      if (r.error) {
        console.error(
          `\n[stage1] ${r.window.label} (${i + 1}/${total}) FAILED: ${r.error}`,
        );
      } else {
        console.log(
          `\n[stage1] ${r.window.label} (${i + 1}/${total}) characters=${n} mentions=${m}`,
        );
      }
    },
  });

  const elapsed = Math.round((Date.now() - t0) / 1000);

  // Stage ② (skip when --stage1Only)
  let merged: Awaited<
    ReturnType<typeof mergeAdjacentWindowCharacters>
  >["characters"] = [];
  let traces: Awaited<
    ReturnType<typeof mergeAdjacentWindowCharacters>
  >["traces"] = [];
  let mergeHit = 0;
  if (!args.stage1Only) {
    const s2 = mergeAdjacentWindowCharacters(byWindow, windows);
    merged = s2.characters;
    traces = s2.traces;
    mergeHit = traces.reduce((n, t) => n + t.merges.length, 0);
    console.log(
      `\n[stage2] pairwise merge → characters=${merged.length} ` +
        `(pairLevels=${traces.length} mergeEdges=${mergeHit})`,
    );
  } else {
    console.log(`\n[stage1Only] skip stage2/3 — per-window extract only`);
  }

  let stage3Result: Awaited<
    ReturnType<typeof resolveCorefWithRulesAndAgent>
  > | null = null;
  if (args.stage3 && !args.stage1Only) {
    console.log(
      `\n[stage3] coref rules` +
        (args.agent ? "+agent" : " (no agent)") +
        ` pairs=C(${merged.length},2)=${(merged.length * (merged.length - 1)) / 2}`,
    );
    stage3Result = await resolveCorefWithRulesAndAgent(merged, windows, {
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
        process.stdout.write(
          `\r[stage3] ${phase}${info.llmMode ? "/" + info.llmMode : ""} ${info.index + 1}/${info.total} ${info.idA}~${info.idB} score=${info.score.toFixed(2)}   `,
        );
      },
    });
    console.log(
      `\n[stage3] done characters ${merged.length} → ${stage3Result.characters.length} ` +
        `autoMerge=${stage3Result.stats.autoMerge} autoReject=${stage3Result.stats.autoReject} ` +
        `agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep} ` +
        `agentMerge=${stage3Result.stats.agentMerge} ` +
        `sameSurfacePass=${stage3Result.stats.sameSurfacePass}` +
        `(merge=${stage3Result.stats.sameSurfaceMerge}) ` +
        `agentConcurrency=${stage3Result.config.agentConcurrency}`,
    );
  }

  const jsonPath = path.join(runDir, "result.json");
  const mdPath = path.join(runDir, "result.md");

  const stageLabel = args.stage1Only
    ? "1"
    : args.stage3
      ? "1+2+3"
      : "1+2";
  const payload = {
    stage: stageLabel,
    ranAt: new Date().toISOString(),
    title,
    source,
    textLength: text.length,
    config,
    windowCount: windows.length,
    elapsedSec: elapsed,
    runDir,
    cotDir: path.relative(process.cwd(), process.env.LLM_COT_DIR || cotDir),
    cotNote: "CoT under <runDir>/cot/<tool>/ (same folder as result.json/md)",
    stage2: args.stage1Only
      ? null
      : {
          mode: "pairwise-hierarchical-overlap-offset",
          characterCount: merged.length,
          pairLevels: traces.length,
          mergeEdges: mergeHit,
          characters: merged,
          traces,
        },
    stage3: stage3Result
      ? {
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
        }
      : null,
    byWindow: byWindow.map((w) => ({
      ...w.window,
      characterCount: w.characters.length,
      mentionCount: w.characters.reduce((s, c) => s + c.mentions.length, 0),
      error: w.error,
      characters: w.characters,
    })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const md: string[] = [
    `# Character analysis Stage${stageLabel} — ${title}`,
    ``,
    `- source: \`${source}\``,
    `- textLen: ${text.length}`,
    `- windows: ${windows.length} (chars=${config.windowChars}, overlap=${config.overlapChars})`,
    `- elapsed: ${elapsed}s`,
    `- runDir: \`${runDir}\``,
    `- CoT: \`${path.join(runDir, "cot", "extract_window_characters")}/\` (按窗 wN；含 PROMPT + 思维链 + JSON)`,
  ];
  if (!args.stage1Only) {
    md.push(
      `- **stage2 merged characters: ${merged.length}** (pairLevels=${traces.length}, mergeEdges=${mergeHit})`,
      `- stage2 mode: pairwise hierarchical; auto-merge if shared **proper|personal_nick** surface (any offset) OR identical surface+offset in overlap (strong≥1 / mid≥2 / weak≥3)`,
    );
  }
  if (stage3Result) {
    md.push(
      `- **stage3 characters: ${stage3Result.characters.length}** ` +
        `(autoMerge=${stage3Result.stats.autoMerge}, autoReject=${stage3Result.stats.autoReject}, ` +
        `agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep}, ` +
        `agentMerge=${stage3Result.stats.agentMerge}, ` +
        `sameSurfacePass=${stage3Result.stats.sameSurfacePass}/` +
        `merge=${stage3Result.stats.sameSurfaceMerge})`,
    );
  }
  md.push(``);
  if (stage3Result) {
    md.push(`## Stage3 消解后人物列表`);
    md.push(``);
    for (const c of stage3Result.characters) {
      const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
      md.push(
        `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
          `{${surfaces.join("、")}} n=${c.mentions.length}` +
          (c.gender ? ` gender=${c.gender}` : "") +
          (c.age ? ` age=${c.age}` : ""),
      );
    }
    md.push(``);
  }
  if (!args.stage1Only) {
    md.push(`## Stage2 全局人物列表`);
    md.push(``);
    for (const c of merged) {
      const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
      md.push(
        `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
          `{${surfaces.join("、")}} n=${c.mentions.length}` +
          (c.gender ? ` gender=${c.gender}` : "") +
          (c.age ? ` age=${c.age}` : ""),
      );
    }
    md.push(``);
  }
  md.push(`## Stage1 分窗`);
  md.push(``);
  for (const w of byWindow) {
    md.push(
      `### ${w.window.label}  [global ${w.window.start}–${w.window.end})`,
    );
    if (w.error) md.push(`**ERROR:** ${w.error}`);
    md.push(`characters=${w.characters.length}`);
    md.push(summarize(w.characters) || "  （无）");
    md.push("");
  }
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  const tag = args.stage1Only
    ? "stage1"
    : args.stage3
      ? "stage1+2+3"
      : "stage1+2";
  console.log(
    `\n[${tag}] done in ${elapsed}s windows=${windows.length}` +
      (args.stage1Only
        ? ""
        : ` s2=${merged.length}`) +
      (stage3Result ? ` s3=${stage3Result.characters.length}` : ""),
  );
  console.log(`[${tag}] wrote ${jsonPath}`);
  console.log(`[${tag}] wrote ${mdPath}`);
  console.log(`[${tag}] runDir: ${runDir}`);
  console.log(
    `[${tag}] CoT dir: ${path.join(runDir, "cot", "extract_window_characters")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
