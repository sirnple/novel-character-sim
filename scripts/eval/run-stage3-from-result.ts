/**
 * Re-run Stage ③ only, using stage2 characters from a previous eval result.json.
 *
 *   npx tsx scripts/eval/run-stage3-from-result.ts --concurrency=30 \
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
  resolveCorefWithRulesAndAgent,
  type MergedCharacter,
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

async function main() {
  const args = parseArgs();
  if (!args.src) {
    throw new Error(
      "Usage: npx tsx scripts/eval/run-stage3-from-result.ts [--concurrency=30] <runDir|result.json>",
    );
  }

  const srcPath = path.resolve(args.src);
  const resultPath = fs.statSync(srcPath).isDirectory()
    ? path.join(srcPath, "result.json")
    : srcPath;
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Missing ${resultPath}`);
  }

  const prev = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
    title?: string;
    source?: string;
    textLength?: number;
    config?: { windowChars?: number; overlapChars?: number };
    stage2?: {
      characters?: MergedCharacter[];
      characterCount?: number;
      pairLevels?: number;
      mergeEdges?: number;
      traces?: unknown;
    };
  };

  const stage2Chars = prev.stage2?.characters;
  if (!stage2Chars?.length) {
    throw new Error("No stage2.characters in result.json");
  }

  const source = prev.source || "";
  if (!source || source.startsWith("db:") || !fs.existsSync(source)) {
    throw new Error(
      `Need local novel file path in result.source (got ${source})`,
    );
  }
  const text = readNovelFile(source);
  const windowChars = prev.config?.windowChars ?? 6000;
  const overlapChars = prev.config?.overlapChars ?? 800;
  const windows = buildAnalysisWindows(text, { windowChars, overlapChars });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = (prev.title || "novel")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .slice(0, 40);
  const runDir = path.join(
    "scripts",
    "eval",
    "results",
    `char-s3-rerun-${slug}-${stamp}`,
  );
  const cotDir = path.join(runDir, "cot");
  fs.mkdirSync(cotDir, { recursive: true });
  process.env.LLM_COT_DIR = path.resolve(cotDir);

  console.log(`[stage3-rerun] from=${resultPath}`);
  console.log(
    `[stage3-rerun] stage2 characters=${stage2Chars.length} windows=${windows.length}`,
  );
  console.log(`[stage3-rerun] concurrency=${args.concurrency} agent=${args.agent}`);
  console.log(`[stage3-rerun] runDir=${runDir}`);

  const llm = createLLMProvider("analysis");
  const t0 = Date.now();
  const stage3Result = await resolveCorefWithRulesAndAgent(
    stage2Chars,
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
        const done = info.completed ?? info.index + 1;
        process.stdout.write(
          `\r[stage3] ${phase} ${done}/${info.total} ${info.idA}~${info.idB} score=${info.score.toFixed(2)}   `,
        );
      },
    },
  );
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const uncertainPairs = stage3Result.uncertainPairs || [];
  console.log(
    `\n[stage3] done ${stage2Chars.length} → ${stage3Result.characters.length} ` +
      `autoMerge=${stage3Result.stats.autoMerge} autoReject=${stage3Result.stats.autoReject} ` +
      `agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep} ` +
      `agentMerge=${stage3Result.stats.agentMerge} agentReject=${stage3Result.stats.agentReject} ` +
      `agentUncertain=${stage3Result.stats.agentUncertain} uncertainPairs=${uncertainPairs.length} ` +
      `sameSurfacePass=${stage3Result.stats.sameSurfacePass}` +
      `(merge=${stage3Result.stats.sameSurfaceMerge}) ${elapsed}s`,
  );

  const payload = {
    stage: "3-rerun",
    ranAt: new Date().toISOString(),
    sourceResult: resultPath,
    title: prev.title,
    source,
    textLength: text.length,
    config: { windowChars, overlapChars },
    windowCount: windows.length,
    elapsedSec: elapsed,
    runDir,
    cotDir: path.relative(process.cwd(), process.env.LLM_COT_DIR || cotDir),
    stage2: {
      characterCount: stage2Chars.length,
      pairLevels: prev.stage2?.pairLevels,
      mergeEdges: prev.stage2?.mergeEdges,
      characters: stage2Chars,
      traces: prev.stage2?.traces,
    },
    stage3: {
      config: stage3Result.config,
      inputCount: stage3Result.inputCount,
      characterCount: stage3Result.characters.length,
      pairCount: stage3Result.pairCount,
      stats: stage3Result.stats,
      characters: stage3Result.characters,
      uncertainPairs,
      scored: stage3Result.scored.filter(
        (s) =>
          s.decision === "auto_merge" ||
          s.decision === "agent" ||
          s.decision === "agent_merge" ||
          s.decision === "agent_reject" ||
          s.decision === "agent_uncertain" ||
          s.decision === "agent_skipped",
      ),
    },
  };

  const jsonPath = path.join(runDir, "result.json");
  const mdPath = path.join(runDir, "result.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const surfacesOf = (id: string) => {
    const c = stage2Chars.find((x) => x.id === id);
    if (!c) return "?";
    return Array.from(new Set(c.mentions.map((m) => m.surface))).slice(0, 10).join("、");
  };

  const md: string[] = [
    `# Character analysis Stage3 re-run — ${prev.title || ""}`,
    ``,
    `- sourceResult: \`${resultPath}\``,
    `- source: \`${source}\``,
    `- stage2 input: ${stage2Chars.length}`,
    `- stage3 output: ${stage3Result.characters.length}`,
    `- elapsed: ${elapsed}s`,
    `- autoMerge=${stage3Result.stats.autoMerge} autoReject=${stage3Result.stats.autoReject}`,
    `- agent=${stage3Result.stats.agent} oneshot=${stage3Result.stats.agentOneshot} deep=${stage3Result.stats.agentDeep}`,
    `- agentMerge=${stage3Result.stats.agentMerge} agentReject=${stage3Result.stats.agentReject} agentUncertain=${stage3Result.stats.agentUncertain} agentSkipped=${stage3Result.stats.agentSkipped}`,
    `- **uncertainPairs: ${uncertainPairs.length}** (for outer character-list agent)`,
    `- sameSurfacePass=${stage3Result.stats.sameSurfacePass}/merge=${stage3Result.stats.sameSurfaceMerge}`,
    ``,
  ];

  if (uncertainPairs.length) {
    md.push(`## Uncertain pairs (oneshot 未决，留给外层 agent)`, ``);
    for (const [i, p] of uncertainPairs.entries()) {
      md.push(
        `${i + 1}. \`${p.idA}\` ↔ \`${p.idB}\` score=${p.score.toFixed(2)}`,
        `   - A: {${(p.surfacesA || []).slice(0, 8).join("、") || surfacesOf(p.idA)}}`,
        `   - B: {${(p.surfacesB || []).slice(0, 8).join("、") || surfacesOf(p.idB)}}`,
        `   - reason: ${(p.reason || "").slice(0, 200)}`,
        ``,
      );
    }
  } else {
    md.push(`## Uncertain pairs`, ``, `（无 — oneshot 均 same/diff 或未进 grey）`, ``);
  }

  md.push(`## Stage3 消解后人物列表`, ``);
  for (const c of stage3Result.characters) {
    const surfaces = Array.from(new Set(c.mentions.map((m) => m.surface)));
    md.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
        `{${surfaces.join("、")}} n=${c.mentions.length}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : ""),
    );
  }
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  console.log(`[stage3-rerun] wrote ${jsonPath}`);
  console.log(`[stage3-rerun] wrote ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
