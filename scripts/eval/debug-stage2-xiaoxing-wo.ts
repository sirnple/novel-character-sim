/**
 * Reproduce stage2 merge and explain why 小星老师 merged with 我.
 * Uses latest (or given) stage1+2 JSON that has byWindow.
 *
 *   npx tsx scripts/eval/debug-stage2-xiaoxing-wo.ts
 *   npx tsx scripts/eval/debug-stage2-xiaoxing-wo.ts path/to/result.json
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildAnalysisWindows,
  mergeAdjacentWindowCharacters,
  locateCharactersInWindow,
  sharedSurfacesInOverlap,
  junctionOverlap,
  type MergedCharacter,
} from "../../src/core/character-analysis";
import type {
  AnalysisWindow,
  WindowExtractResult,
} from "../../src/core/character-analysis/types";

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

function surList(c: { mentions: { surface: string }[] }): string[] {
  return Array.from(
    new Set(c.mentions.map((m) => m.surface).filter(Boolean)),
  );
}

function hasWo(c: { mentions: { surface: string }[] }): boolean {
  return c.mentions.some((m) => m.surface === "我");
}
function hasXing(c: { mentions: { surface: string }[] }): boolean {
  return c.mentions.some((m) =>
    /星|老师|黎星|班主任/.test(m.surface),
  );
}

async function main() {
  const jsonPath = pickJson();
  console.log("using", jsonPath);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  // Rebuild windows from text if available, else from byWindow ranges
  let windows: AnalysisWindow[] = [];
  let byWindow: WindowExtractResult[] = j.byWindow || [];

  if (!byWindow.length) throw new Error("no byWindow in json");

  const cfg = j.config || { windowChars: 6000, overlapChars: 800 };
  const src = j.source as string;
  if (src && fs.existsSync(src)) {
    let text = fs.readFileSync(src);
    // try utf8
    let t = text.toString("utf8");
    if (t.includes("\uFFFD") || /Ã./.test(t.slice(0, 100))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const iconv = require("iconv-lite");
      t = iconv.decode(text, "gbk");
    }
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    windows = buildAnalysisWindows(t, cfg);
  } else {
    windows = byWindow.map((w: any) => ({
      index: w.index,
      label: w.label,
      start: w.start,
      end: w.end,
      text: "", // locate may fail without text
    }));
    console.warn("source text missing; using empty window.text (locate may fail)");
  }

  // Normalize byWindow shape
  byWindow = byWindow.map((w: any) => ({
    window: {
      index: w.index,
      label: w.label,
      start: w.start,
      end: w.end,
    },
    characters: w.characters || [],
    error: w.error,
  }));

  console.log("\n=== Stage1 per-window: 我 / 小星相关 ===");
  for (const w of byWindow) {
    const win = windows.find((x) => x.index === w.window.index) || {
      ...w.window,
      text: "",
    };
    console.log(
      `\n--- ${w.window.label} global[${w.window.start},${w.window.end}) ---`,
    );
    for (const c of w.characters) {
      const surs = surList(c);
      if (!hasWo(c) && !hasXing(c)) continue;
      console.log(
        `  char gender=${c.gender || "?"} age=${c.age || "?"} surfaces={${surs.join("、")}}`,
      );
      for (const m of c.mentions) {
        if (m.surface === "我" || /星|老师|黎|班/.test(m.surface)) {
          console.log(`    surface=${m.surface}  anchor=「${m.textAnchor}」`);
        }
      }
      // locate
      if (win.text) {
        const loc = locateCharactersInWindow([c], win as AnalysisWindow);
        for (const lc of loc) {
          for (const m of lc.mentions) {
            if (m.surface === "我" || /星|老师|黎|班/.test(m.surface)) {
              const o = m.offsetAnchor;
              console.log(
                `    LOCATED ${m.surface} global=${o.globalStart}-${o.globalEnd} local=${o.localStart}`,
              );
            }
          }
        }
      }
    }
  }

  const { characters, traces, locatedByWindow } =
    mergeAdjacentWindowCharacters(byWindow, windows);

  console.log("\n=== Stage2 traces (all pair levels) ===");
  for (const t of traces) {
    const ov = t.overlap;
    console.log(
      `\npair leftWin=[${t.leftWindows}] rightWin=[${t.rightWindows}] overlap=${
        ov ? `[${ov.start},${ov.end})` : "null"
      } merges=${t.merges.length}`,
    );
    for (const m of t.merges) {
      console.log(
        `  MERGE ${m.leftId} + ${m.rightId} sharedInOverlap=${m.sharedSurfacesInOverlap.join(",")}`,
      );
    }
  }

  console.log("\n=== Final stage2 characters with 我 and/or 小星 ===");
  for (const c of characters) {
    if (!hasWo(c) && !hasXing(c)) continue;
    console.log(
      `\n${c.id} win=[${c.windowLo}..${c.windowHi}] g=${c.gender || "?"} {${surList(c).join("、")}}`,
    );
    for (const m of c.mentions) {
      const o = m.offsetAnchor;
      console.log(
        `  @${o?.globalStart ?? "?"}-${o?.globalEnd ?? "?"} ${m.surface} 「${m.textAnchor}」`,
      );
    }
  }

  // Deep dive: first level merge window 0 and 1
  console.log("\n=== Deep dive: overlap win0∩win1 and candidates ===");
  const w0 = windows[0];
  const w1 = windows[1];
  if (w0 && w1) {
    const ov = junctionOverlap(windows, 0, 0, 1, 1);
    console.log("junction overlap", ov);
    const loc0 = locatedByWindow.find((x) => x.windowIndex === 0)?.characters || [];
    const loc1 = locatedByWindow.find((x) => x.windowIndex === 1)?.characters || [];
    console.log("win0 located chars:", loc0.length);
    for (const c of loc0) {
      if (hasWo(c) || hasXing(c)) {
        console.log(
          "  L",
          surList(c).join("/"),
          c.mentions
            .map(
              (m) =>
                `${m.surface}@${m.offsetAnchor.globalStart} inOv=${
                  ov
                    ? m.offsetAnchor.globalStart >= ov.start &&
                      m.offsetAnchor.globalStart < ov.end
                    : "?"
                }`,
            )
            .join(", "),
        );
      }
    }
    console.log("win1 located chars:", loc1.length);
    for (const c of loc1) {
      if (hasWo(c) || hasXing(c)) {
        console.log(
          "  R",
          surList(c).join("/"),
          c.mentions
            .map(
              (m) =>
                `${m.surface}@${m.offsetAnchor.globalStart} inOv=${
                  ov
                    ? m.offsetAnchor.globalStart >= ov.start &&
                      m.offsetAnchor.globalStart < ov.end
                    : "?"
                }`,
            )
            .join(", "),
        );
      }
    }
    // pairwise shared in overlap
    console.log("\npairwise sharedSurfacesInOverlap among 我/星 related:");
    for (let i = 0; i < loc0.length; i++) {
      for (let j = 0; j < loc1.length; j++) {
        const a = loc0[i]!;
        const b = loc1[j]!;
        if ((!hasWo(a) && !hasXing(a)) || (!hasWo(b) && !hasXing(b))) continue;
        const shared = ov
          ? sharedSurfacesInOverlap(
              {
                id: `L${i}`,
                mentions: a.mentions,
                windowLo: 0,
                windowHi: 0,
              } as MergedCharacter,
              {
                id: `R${j}`,
                mentions: b.mentions,
                windowLo: 1,
                windowHi: 1,
              } as MergedCharacter,
              ov,
            )
          : [];
        if (shared.length || hasXing(a) || hasXing(b) || hasWo(a) || hasWo(b)) {
          console.log(
            `  L${i}{${surList(a)}} × R${j}{${surList(b)}} sharedInOv=${shared.join(",") || "∅"}`,
          );
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
