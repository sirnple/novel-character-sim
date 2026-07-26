/**
 * Full character analysis: ① window → ② overlap → ③ oneshot → ④ canonicalName
 * then outer agent tool-loop merge for oneshot uncertain pairs.
 *
 *   npx tsx scripts/eval/run-character-analysis-full.ts --concurrency=12 "C:\path\novel.txt"
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { loadEnvLocal } from "../lib/load-env-local";
import { formatMentionsWithOffset } from "./lib/format-mentions";

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
  runCharacterAnalysisPipeline,
  mergeTwoMergedCharacters,
  type MergedCharacter,
} from "../../src/core/character-analysis";
import {
  agentJudgeSamePersonAgent,
  buildPairFeatures,
  buildCooccurGraph,
  mergeStage3Config,
  type UncertainCorefPair,
} from "../../src/core/character-analysis/coref";
import { UnionFind } from "../../src/core/character-analysis/coref/union-find";

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
  let concurrency = 12;
  let stage3Concurrency = 12;
  let stage4Concurrency = 8;
  let agentConcurrency = 4;
  let maxWindows: number | null = null;
  let windowChars = 6000;
  let overlapChars = 800;
  let skipAgent = false;
  const positional: string[] = [];
  for (const a of process.argv.slice(2)) {
    let m: RegExpMatchArray | null;
    if ((m = a.match(/^--concurrency=(\d+)$/))) {
      concurrency = Math.max(1, Math.min(32, parseInt(m[1]!, 10)));
      continue;
    }
    if ((m = a.match(/^--stage3Concurrency=(\d+)$/))) {
      stage3Concurrency = Math.max(1, Math.min(32, parseInt(m[1]!, 10)));
      continue;
    }
    if ((m = a.match(/^--stage4Concurrency=(\d+)$/))) {
      stage4Concurrency = Math.max(1, Math.min(32, parseInt(m[1]!, 10)));
      continue;
    }
    if ((m = a.match(/^--agentConcurrency=(\d+)$/))) {
      agentConcurrency = Math.max(1, Math.min(16, parseInt(m[1]!, 10)));
      continue;
    }
    if ((m = a.match(/^--maxWindows=(\d+)$/))) {
      maxWindows = Math.max(1, parseInt(m[1]!, 10));
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
    if (a === "--noAgentMerge") {
      skipAgent = true;
      continue;
    }
    if (!a.startsWith("-")) positional.push(a);
  }
  return {
    filePath: positional[0] || null,
    concurrency,
    stage3Concurrency,
    stage4Concurrency,
    agentConcurrency,
    maxWindows,
    windowChars,
    overlapChars,
    skipAgent,
  };
}

function surfacesOf(c: MergedCharacter): string[] {
  return Array.from(
    new Set((c.mentions || []).map((m) => (m.surface || "").trim()).filter(Boolean)),
  );
}

function rebuildFromUnion(
  characters: MergedCharacter[],
  uf: UnionFind,
): MergedCharacter[] {
  const groups = new Map<string, MergedCharacter[]>();
  for (const c of characters) {
    const root = uf.find(c.id);
    const list = groups.get(root) || [];
    list.push(c);
    groups.set(root, list);
  }
  const out: MergedCharacter[] = [];
  for (const [, members] of groups) {
    if (members.length === 1) {
      out.push(members[0]!);
      continue;
    }
    const rootId = members[0]!.id;
    let acc = members[0]!;
    for (let i = 1; i < members.length; i++) {
      acc = mergeTwoMergedCharacters(acc, members[i]!, rootId);
    }
    out.push(acc);
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.filePath) {
    throw new Error(
      'Usage: npx tsx scripts/eval/run-character-analysis-full.ts [--concurrency=12] "novel.txt"',
    );
  }
  const source = path.resolve(args.filePath);
  if (!fs.existsSync(source)) throw new Error(`File not found: ${source}`);
  const text = readNovelFile(source);
  const title = path.basename(source, path.extname(source));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = title.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40);
  const runDir = path.join(
    "scripts",
    "eval",
    "results",
    `char-full-${slug}-${stamp}`,
  );
  const cotDir = path.join(runDir, "cot");
  fs.mkdirSync(cotDir, { recursive: true });
  process.env.LLM_COT_DIR = path.resolve(cotDir);

  console.log(`[full] title=${title}`);
  console.log(`[full] source=${source} textLen=${text.length}`);
  console.log(
    `[full] concurrency s1=${args.concurrency} s3=${args.stage3Concurrency} s4=${args.stage4Concurrency} agent=${args.agentConcurrency}`,
  );
  console.log(`[full] runDir=${runDir}`);

  const llm = createLLMProvider("analysis");
  const t0 = Date.now();

  // ── Pipeline ①–④ ─────────────────────────────────────────────
  const pipeline = await runCharacterAnalysisPipeline(text, llm, {
    concurrency: args.concurrency,
    maxWindows: args.maxWindows,
    stage3Agent: true,
    stage3Concurrency: args.stage3Concurrency,
    stage4Llm: true,
    stage4Concurrency: args.stage4Concurrency,
    agentContextRadius: 220,
    stage1: {
      windowChars: args.windowChars,
      overlapChars: args.overlapChars,
      concurrency: args.concurrency,
      maxWindows: args.maxWindows,
    },
    onProgress: (msg) => console.log(msg),
    onStage3AgentPair: (info) => {
      process.stdout.write(
        `\r[stage3] oneshot ${info.completed ?? info.index + 1}/${info.total} ${info.idA}~${info.idB}   `,
      );
    },
  });

  const uncertainPairs: UncertainCorefPair[] =
    pipeline.stage3.uncertainPairs || [];
  console.log(
    `\n[full] pipeline done ${Math.round((Date.now() - t0) / 1000)}s ` +
      `s2=${pipeline.stage2.characters.length} ` +
      `s3=${pipeline.stage3.characters.length} ` +
      `s4=${pipeline.stage4.characters.length} ` +
      `uncertain=${uncertainPairs.length} ` +
      `stats=${JSON.stringify(pipeline.stage3.stats)}`,
  );

  // Checkpoint after ①–④ so agent failures don't lose pipeline work
  const checkpoint = {
    stage: "pipeline-1-4",
    ranAt: new Date().toISOString(),
    title,
    source,
    textLength: text.length,
    config: {
      windowChars: args.windowChars,
      overlapChars: args.overlapChars,
      concurrency: args.concurrency,
      stage3Concurrency: args.stage3Concurrency,
      stage4Concurrency: args.stage4Concurrency,
      agentConcurrency: args.agentConcurrency,
    },
    elapsedSecPipeline: Math.round((Date.now() - t0) / 1000),
    runDir,
    stage1: {
      windowCount: pipeline.windows.length,
      config: pipeline.config,
      byWindow: pipeline.byWindow,
      windows: pipeline.windows.map((w) => ({
        index: w.index,
        label: w.label,
        start: w.start,
        end: w.end,
      })),
    },
    stage2: {
      characterCount: pipeline.stage2.characters.length,
      characters: pipeline.stage2.characters,
      traces: pipeline.stage2.traces,
    },
    stage3: {
      characterCount: pipeline.stage3.characters.length,
      inputCount: pipeline.stage3.inputCount,
      pairCount: pipeline.stage3.pairCount,
      stats: pipeline.stage3.stats,
      characters: pipeline.stage3.characters,
      uncertainPairs,
      scored: pipeline.stage3.scored.filter(
        (s) =>
          s.decision === "auto_merge" ||
          s.decision === "agent_merge" ||
          s.decision === "agent_reject" ||
          s.decision === "agent_uncertain" ||
          s.decision === "agent_skipped",
      ),
    },
    stage4: {
      characterCount: pipeline.stage4.characters.length,
      characters: pipeline.stage4.characters,
    },
  };
  const checkpointPath = path.join(runDir, "pipeline-checkpoint.json");
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
  console.log(`[full] wrote checkpoint ${checkpointPath}`);

  // ── Outer agent merge for uncertain pairs ────────────────────
  type AgentPairResult = {
    idA: string;
    idB: string;
    merge: boolean;
    reason: string;
    score: number;
  };
  const agentResults: AgentPairResult[] = [];
  let finalChars = pipeline.stage4.characters.slice();

  if (!args.skipAgent && uncertainPairs.length) {
    console.log(
      `[agent] resolving ${uncertainPairs.length} uncertain pair(s) with tool-loop`,
    );
    const cfg = mergeStage3Config({});
    const byId = new Map(finalChars.map((c) => [c.id, c]));
    // Keep pre-merge roster for features (ids match uncertain pairs)
    const rosterById = new Map(finalChars.map((c) => [c.id, c]));
    const graph = buildCooccurGraph(
      finalChars,
      pipeline.windows,
      text.length,
    );
    const uf = new UnionFind();
    for (const c of finalChars) uf.add(c.id);

    const outcomes = await mapPool(
      uncertainPairs,
      args.agentConcurrency,
      async (pair, i) => {
        const a = rosterById.get(pair.idA);
        const b = rosterById.get(pair.idB);
        process.stdout.write(
          `\r[agent] ${i + 1}/${uncertainPairs.length} ${pair.idA}~${pair.idB}   `,
        );
        if (!a || !b) {
          return {
            idA: pair.idA,
            idB: pair.idB,
            merge: false,
            reason: "missing entity after pipeline",
            score: pair.score,
          } satisfies AgentPairResult;
        }
        try {
          const features = buildPairFeatures(a, b, cfg, graph);
          const ans = await agentJudgeSamePersonAgent(llm, a, b, features, {
            fullText: text,
            windows: pipeline.windows,
            contextRadius: 280,
            maxMentionsPerChar: 5,
            stripDeicticWhenHasName: true,
            rosterById,
            cooccurGraph: graph,
            toolLoopMaxSteps: 8,
          });
          return {
            idA: pair.idA,
            idB: pair.idB,
            merge: ans.verdict === "same" || ans.same === true,
            reason: ans.reason || "",
            score: pair.score,
          } satisfies AgentPairResult;
        } catch (e) {
          return {
            idA: pair.idA,
            idB: pair.idB,
            merge: false,
            reason: e instanceof Error ? e.message : String(e),
            score: pair.score,
          } satisfies AgentPairResult;
        }
      },
    );

    let mergeN = 0;
    let distinctN = 0;
    for (const o of outcomes) {
      agentResults.push(o);
      if (o.merge) {
        mergeN++;
        if (byId.has(o.idA) && byId.has(o.idB)) {
          uf.union(o.idA, o.idB);
        }
      } else {
        distinctN++;
      }
    }
    finalChars = rebuildFromUnion(finalChars, uf);
    console.log(
      `\n[agent] done merge=${mergeN} distinct/skip=${distinctN} → characters=${finalChars.length}`,
    );
  } else if (uncertainPairs.length && args.skipAgent) {
    console.log(`[agent] skipped (--noAgentMerge); leave ${uncertainPairs.length} uncertain as separate`);
  } else {
    console.log(`[agent] no uncertain pairs`);
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);

  const payload = {
    stage: "full-1-4+agent",
    ranAt: new Date().toISOString(),
    title,
    source,
    textLength: text.length,
    config: {
      windowChars: args.windowChars,
      overlapChars: args.overlapChars,
      concurrency: args.concurrency,
      stage3Concurrency: args.stage3Concurrency,
      stage4Concurrency: args.stage4Concurrency,
      agentConcurrency: args.agentConcurrency,
    },
    elapsedSec: elapsed,
    runDir,
    cotDir: path.relative(process.cwd(), process.env.LLM_COT_DIR || cotDir),
    stage1: {
      windowCount: pipeline.windows.length,
      config: pipeline.config,
    },
    stage2: {
      characterCount: pipeline.stage2.characters.length,
      characters: pipeline.stage2.characters,
      traces: pipeline.stage2.traces,
    },
    stage3: {
      characterCount: pipeline.stage3.characters.length,
      inputCount: pipeline.stage3.inputCount,
      pairCount: pipeline.stage3.pairCount,
      stats: pipeline.stage3.stats,
      characters: pipeline.stage3.characters,
      uncertainPairs,
      scored: pipeline.stage3.scored.filter(
        (s) =>
          s.decision === "auto_merge" ||
          s.decision === "agent_merge" ||
          s.decision === "agent_reject" ||
          s.decision === "agent_uncertain" ||
          s.decision === "agent_skipped",
      ),
    },
    stage4: {
      characterCount: pipeline.stage4.characters.length,
      characters: pipeline.stage4.characters,
    },
    agent: {
      pairCount: agentResults.length,
      mergeCount: agentResults.filter((r) => r.merge).length,
      distinctCount: agentResults.filter((r) => !r.merge).length,
      results: agentResults,
    },
    final: {
      characterCount: finalChars.length,
      characters: finalChars,
    },
  };

  fs.writeFileSync(
    path.join(runDir, "result.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );

  const md: string[] = [
    `# Character analysis full — ${title}`,
    ``,
    `- source: \`${source}\``,
    `- elapsed: ${elapsed}s`,
    `- stage2: ${pipeline.stage2.characters.length}`,
    `- stage3: ${pipeline.stage3.characters.length} (oneshot uncertain=${uncertainPairs.length})`,
    `- stage4: ${pipeline.stage4.characters.length}`,
    `- agent merge: ${agentResults.filter((r) => r.merge).length}/${agentResults.length}`,
    `- **final: ${finalChars.length}**`,
    `- stage3 stats: \`${JSON.stringify(pipeline.stage3.stats)}\``,
    ``,
  ];

  if (uncertainPairs.length) {
    md.push(`## Uncertain pairs (after oneshot)`, ``);
    for (const [i, p] of uncertainPairs.entries()) {
      const ar = agentResults.find(
        (r) =>
          (r.idA === p.idA && r.idB === p.idB) ||
          (r.idA === p.idB && r.idB === p.idA),
      );
      md.push(
        `${i + 1}. \`${p.idA}\` ↔ \`${p.idB}\` score=${p.score.toFixed(2)}`,
        `   - A: {${(p.surfacesA || []).slice(0, 8).join("、")}}`,
        `   - B: {${(p.surfacesB || []).slice(0, 8).join("、")}}`,
        `   - oneshot: ${(p.reason || "").slice(0, 160)}`,
        ar
          ? `   - **agent: ${ar.merge ? "MERGE" : "distinct"}** — ${(ar.reason || "").slice(0, 160)}`
          : `   - agent: (skipped)`,
        ``,
      );
    }
  }

  md.push(`## Final roster`, ``);
  for (const c of finalChars) {
    const surfaces = surfacesOf(c);
    md.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
        `canonical=${c.canonicalName || "?"} ` +
        `{${formatMentionsWithOffset(c.mentions) || surfaces.join("、")}} ` +
        `n=${c.mentions.length}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : ""),
    );
  }

  fs.writeFileSync(path.join(runDir, "result.md"), md.join("\n"), "utf8");
  console.log(`[full] wrote ${path.join(runDir, "result.json")}`);
  console.log(`[full] wrote ${path.join(runDir, "result.md")}`);
  console.log(`[full] final characters=${finalChars.length} elapsed=${elapsed}s`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
