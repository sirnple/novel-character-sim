/**
 * Resume outer agent merge from a full-pipeline checkpoint
 * (pipeline-checkpoint.json written by run-character-analysis-full.ts).
 *
 *   npx tsx scripts/eval/run-agent-from-checkpoint.ts --agentConcurrency=4 \
 *     scripts/eval/results/char-full-.../pipeline-checkpoint.json
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
  buildAnalysisWindows,
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
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () =>
      worker(),
    ),
  );
  return out;
}

function parseArgs() {
  let agentConcurrency = 4;
  let src: string | null = null;
  for (const a of process.argv.slice(2)) {
    let m: RegExpMatchArray | null;
    if ((m = a.match(/^--agentConcurrency=(\d+)$/))) {
      agentConcurrency = Math.max(1, Math.min(16, parseInt(m[1]!, 10)));
      continue;
    }
    if (!a.startsWith("-")) src = a;
  }
  return { agentConcurrency, src };
}

async function main() {
  const args = parseArgs();
  if (!args.src) {
    throw new Error(
      "Usage: npx tsx scripts/eval/run-agent-from-checkpoint.ts [--agentConcurrency=4] <pipeline-checkpoint.json|runDir>",
    );
  }
  const srcPath = path.resolve(args.src);
  const checkpointPath = fs.statSync(srcPath).isDirectory()
    ? path.join(srcPath, "pipeline-checkpoint.json")
    : srcPath;
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`Missing ${checkpointPath}`);
  }

  const prev = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as {
    title?: string;
    source?: string;
    config?: { windowChars?: number; overlapChars?: number };
    runDir?: string;
    stage3?: {
      uncertainPairs?: UncertainCorefPair[];
      stats?: unknown;
      characterCount?: number;
    };
    stage4?: { characters?: MergedCharacter[]; characterCount?: number };
    stage2?: { characterCount?: number };
    elapsedSecPipeline?: number;
  };

  const stage4Chars = prev.stage4?.characters || [];
  const uncertainPairs = prev.stage3?.uncertainPairs || [];
  if (!stage4Chars.length) throw new Error("No stage4.characters in checkpoint");

  const source = prev.source || "";
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Need novel file at checkpoint.source (got ${source})`);
  }
  const text = readNovelFile(source);
  const windowChars = prev.config?.windowChars ?? 6000;
  const overlapChars = prev.config?.overlapChars ?? 800;
  const windows = buildAnalysisWindows(text, { windowChars, overlapChars });

  const runDir =
    prev.runDir && fs.existsSync(prev.runDir)
      ? prev.runDir
      : path.dirname(checkpointPath);
  const cotDir = path.join(runDir, "cot");
  fs.mkdirSync(cotDir, { recursive: true });
  process.env.LLM_COT_DIR = path.resolve(cotDir);

  console.log(`[agent-resume] checkpoint=${checkpointPath}`);
  console.log(
    `[agent-resume] stage4=${stage4Chars.length} uncertain=${uncertainPairs.length} concurrency=${args.agentConcurrency}`,
  );

  type AgentPairResult = {
    idA: string;
    idB: string;
    merge: boolean;
    reason: string;
    score: number;
  };
  const agentResults: AgentPairResult[] = [];
  let finalChars = stage4Chars.slice();

  const llm = createLLMProvider("analysis");
  const t0 = Date.now();

  if (uncertainPairs.length) {
    const cfg = mergeStage3Config({});
    const byId = new Map(finalChars.map((c) => [c.id, c]));
    const rosterById = new Map(finalChars.map((c) => [c.id, c]));
    const graph = buildCooccurGraph(finalChars, windows, text.length);
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
            windows,
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
    for (const o of outcomes) {
      agentResults.push(o);
      if (o.merge) {
        mergeN++;
        if (byId.has(o.idA) && byId.has(o.idB)) uf.union(o.idA, o.idB);
      }
    }
    finalChars = rebuildFromUnion(finalChars, uf);
    console.log(
      `\n[agent] done merge=${mergeN} distinct/skip=${outcomes.length - mergeN} → ${finalChars.length}`,
    );
  } else {
    console.log(`[agent] no uncertain pairs`);
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  const payload = {
    ...prev,
    stage: "full-1-4+agent",
    agentResumedAt: new Date().toISOString(),
    agentElapsedSec: elapsed,
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
    `# Character analysis full (agent resume) — ${prev.title || ""}`,
    ``,
    `- checkpoint: \`${checkpointPath}\``,
    `- stage2: ${prev.stage2?.characterCount ?? "?"}`,
    `- stage3: ${prev.stage3?.characterCount ?? "?"} uncertain=${uncertainPairs.length}`,
    `- stage4: ${prev.stage4?.characterCount ?? "?"}`,
    `- agent merge: ${agentResults.filter((r) => r.merge).length}/${agentResults.length} (${elapsed}s)`,
    `- **final: ${finalChars.length}**`,
    ``,
  ];
  if (uncertainPairs.length) {
    md.push(`## Uncertain pairs`, ``);
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
          : `   - agent: (n/a)`,
        ``,
      );
    }
  }
  md.push(`## Final roster`, ``);
  for (const c of finalChars) {
    md.push(
      `- \`${c.id}\` windows=[${c.windowLo}..${c.windowHi}] ` +
        `canonical=${c.canonicalName || "?"} ` +
        `{${formatMentionsWithOffset(c.mentions) || surfacesOf(c).join("、")}} ` +
        `n=${c.mentions.length}` +
        (c.gender ? ` gender=${c.gender}` : "") +
        (c.age ? ` age=${c.age}` : ""),
    );
  }
  fs.writeFileSync(path.join(runDir, "result.md"), md.join("\n"), "utf8");
  console.log(`[agent-resume] wrote ${path.join(runDir, "result.json")}`);
  console.log(`[agent-resume] wrote ${path.join(runDir, "result.md")}`);
  console.log(`[agent-resume] final=${finalChars.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
