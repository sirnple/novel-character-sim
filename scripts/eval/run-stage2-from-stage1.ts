/**
 * Stage ② only from a previous stage1 result (no LLM).
 *
 *   npx tsx scripts/eval/run-stage2-from-stage1.ts \
 *     scripts/eval/results/char-s1-欲孽灼心_主线-2026-07-26T13-34-28
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
    for (const line of fs.readFileSync(p, "utf-8").split(/\n/)) {
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

import {
  buildAnalysisWindows,
  mergeAdjacentWindowCharacters,
  type AnalysisWindow,
  type Character,
  type WindowExtractResult,
} from "../../src/core/character-analysis";
import { formatMentionsWithOffset } from "./lib/format-mentions";

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
  const src = process.argv[2];
  if (!src) {
    throw new Error(
      "Usage: npx tsx scripts/eval/run-stage2-from-stage1.ts <stage1-runDir|result.json>",
    );
  }
  const srcPath = path.resolve(src);
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
  if (!prev.byWindow?.length) throw new Error("No byWindow in result.json");
  const source = prev.source || "";
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Need local novel path in result.source (got ${source})`);
  }

  const text = readNovelFile(source);
  const windowChars = prev.config?.windowChars ?? 6000;
  const overlapChars = prev.config?.overlapChars ?? 800;
  const windows = buildAnalysisWindows(text, { windowChars, overlapChars });
  const byWindow = byWindowToExtractResults(prev.byWindow, windows);

  const t0 = Date.now();
  const s2 = mergeAdjacentWindowCharacters(byWindow, windows);
  const mergeHit = s2.traces.reduce(
    (n, tr) => n + (tr.merges?.length || 0),
    0,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = (prev.title || "novel")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .slice(0, 40);
  const runDir = path.join(
    "scripts",
    "eval",
    "results",
    `char-s2-from-s1-${slug}-${stamp}`,
  );
  fs.mkdirSync(runDir, { recursive: true });

  const payload = {
    stage: "stage2-only",
    ranAt: new Date().toISOString(),
    sourceStage1: resultPath,
    title: prev.title,
    source,
    textLength: text.length,
    config: { windowChars, overlapChars },
    windowCount: windows.length,
    elapsedSec: Number(elapsed),
    runDir,
    byWindow: prev.byWindow,
    stage2: {
      characters: s2.characters,
      characterCount: s2.characters.length,
      pairLevels: s2.traces.length,
      mergeEdges: mergeHit,
      traces: s2.traces,
    },
  };
  fs.writeFileSync(
    path.join(runDir, "result.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );

  const lines: string[] = [
    `# Character analysis Stage2 only — ${prev.title || "novel"}`,
    "",
    `- sourceStage1: \`${resultPath}\``,
    `- source: \`${source}\``,
    `- stage1 windows: ${prev.byWindow.length}`,
    `- **stage2 characters: ${s2.characters.length}** (pairLevels=${s2.traces.length}, mergeEdges=${mergeHit})`,
    `- elapsed: ${elapsed}s`,
    `- runDir: \`${runDir}\``,
    "",
    "## Stage2 全局人物列表",
    "",
  ];
  for (const c of s2.characters) {
    const surf = formatMentionsWithOffset(c.mentions || []);
    lines.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] {${surf}} n=${c.mentions?.length ?? 0}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : ""),
    );
  }
  fs.writeFileSync(path.join(runDir, "result.md"), lines.join("\n") + "\n", "utf8");

  console.log(`[stage2-only] from ${resultPath}`);
  console.log(
    `[stage2-only] characters=${s2.characters.length} pairLevels=${s2.traces.length} mergeEdges=${mergeHit} ${elapsed}s`,
  );
  console.log(`[stage2-only] wrote ${path.join(runDir, "result.md")}`);
  console.log(`[stage2-only] runDir: ${runDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
