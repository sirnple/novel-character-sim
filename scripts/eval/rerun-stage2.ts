/**
 * Re-run Stage2 merge from an existing stage1 JSON (no LLM).
 *
 *   npx tsx scripts/eval/rerun-stage2.ts
 *   npx tsx scripts/eval/rerun-stage2.ts path/to/char-s1-....json
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildAnalysisWindows,
  mergeAdjacentWindowCharacters,
} from "../../src/core/character-analysis";

function pickJson(): string {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) return arg;
  const dir = path.join("scripts", "eval", "results");
  const files = fs
    .readdirSync(dir)
    .filter((x) => x.startsWith("char-s1-") && x.endsWith(".json"))
    .map((x) => ({ x, t: fs.statSync(path.join(dir, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error("no char-s1 json");
  return path.join(dir, files[0]!.x);
}

function main() {
  const jsonPath = pickJson();
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const cfg = j.config || { windowChars: 6000, overlapChars: 800 };

  if (!j.source || !fs.existsSync(j.source)) {
    throw new Error(`source missing: ${j.source}`);
  }
  let buf = fs.readFileSync(j.source);
  let t = buf.toString("utf8");
  if (t.includes("\uFFFD") || /Ã./.test(t.slice(0, 100))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iconv = require("iconv-lite");
    t = iconv.decode(buf, "gbk");
  }
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);

  const windows = buildAnalysisWindows(t, cfg);
  const byWindow = (j.byWindow || []).map((w: {
    index: number;
    label: string;
    start: number;
    end: number;
    characters?: unknown[];
    error?: string;
  }) => ({
    window: {
      index: w.index,
      label: w.label,
      start: w.start,
      end: w.end,
    },
    characters: w.characters || [],
    error: w.error,
  }));

  const stage1Count = byWindow.reduce(
    (s, w) => s + (w.characters?.length || 0),
    0,
  );
  const { characters, traces } = mergeAdjacentWindowCharacters(
    byWindow as never,
    windows,
  );
  const mergeHit = traces.reduce((n, tr) => n + tr.merges.length, 0);

  const lines: string[] = [];
  lines.push("# Stage2 re-run");
  lines.push("");
  lines.push(
    "rule: merge only if **identical mention** in junction overlap",
  );
  lines.push("(identical = same surface **and** same offsetAnchor)");
  lines.push("");
  lines.push(`- source json: \`${jsonPath}\``);
  lines.push(`- stage1 windows: ${byWindow.length}`);
  lines.push(`- stage1 chars (sum): ${stage1Count}`);
  lines.push(`- **stage2 characters: ${characters.length}**`);
  lines.push(`- pairLevels: ${traces.length}`);
  lines.push(`- **mergeEdges: ${mergeHit}**`);
  lines.push(
    `- previous stored stage2: ${j.stage2?.characterCount ?? "?"} chars, ${j.stage2?.mergeEdges ?? "?"} edges`,
  );

  lines.push("");
  lines.push("## Traces");
  for (const tr of traces) {
    const ov = tr.overlap;
    lines.push("");
    lines.push(
      `pair leftWin=[${tr.leftWindows}] rightWin=[${tr.rightWindows}] ` +
        `overlap=${ov ? `[${ov.start},${ov.end})` : "null"} ` +
        `merges=${tr.merges.length}`,
    );
    for (const m of tr.merges) {
      lines.push(
        `  - MERGE ${m.leftId} + ${m.rightId} shared=${m.sharedSurfacesInOverlap.join(",")}`,
      );
    }
  }

  lines.push("");
  lines.push("## Focus: 我 / 小星 / 黎星");
  for (const c of characters) {
    const surs = c.mentions.map((m) => m.surface);
    if (!surs.some((s) => s === "我" || /星|老师|黎星/.test(s))) continue;
    lines.push("");
    lines.push(
      `### ${c.id} win=[${c.windowLo}..${c.windowHi}] g=${c.gender || "?"} ` +
        `{${Array.from(new Set(surs)).join("、")}}`,
    );
    for (const m of c.mentions) {
      if (m.surface === "我" || /星|老师|黎/.test(m.surface)) {
        const a = (m.textAnchor || "").slice(0, 48);
        lines.push(
          `- ${m.surface}@${m.offsetAnchor?.globalStart ?? "?"} 「${a}」`,
        );
      }
    }
  }

  lines.push("");
  lines.push("## All stage2 characters (compact)");
  for (const c of characters) {
    const surs = Array.from(new Set(c.mentions.map((m) => m.surface))).join(
      "、",
    );
    lines.push(
      `- ${c.id} [${c.windowLo}..${c.windowHi}] g=${c.gender || "?"} {${surs}}`,
    );
  }

  const outDir = path.join("scripts", "eval", "results");
  const out = path.join(outDir, "_stage2-rerun-summary.md");
  fs.writeFileSync(out, lines.join("\n"), "utf8");

  // also dump machine-readable
  const jsonOut = path.join(outDir, "_stage2-rerun.json");
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        source: jsonPath,
        characterCount: characters.length,
        mergeEdges: mergeHit,
        pairLevels: traces.length,
        traces,
        characters,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(lines.join("\n"));
  console.log(`\n--- wrote ${out}`);
  console.log(`--- wrote ${jsonOut}`);
}

main();
