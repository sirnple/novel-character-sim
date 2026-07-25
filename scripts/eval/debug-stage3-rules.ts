/**
 * Re-run Stage3 from a saved stage1+2(+3) JSON; dump every rule on every pair
 * (especially auto_merge edges that form over-merged components).
 *
 *   npx tsx scripts/eval/debug-stage3-rules.ts
 *   npx tsx scripts/eval/debug-stage3-rules.ts path/to/char-s1-....json
 *   npx tsx scripts/eval/debug-stage3-rules.ts --agent path/to.json   # also run agent
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
  for (const name of [".env", ".env.local"] as const) {
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

import { createLLMProvider } from "../../src/core/llm/factory";
import {
  buildAnalysisWindows,
  resolveCorefWithRulesAndAgent,
  buildCooccurGraph,
  buildPairFeatures,
  scorePair,
  decideByThresholds,
  mergeStage3Config,
  ALL_COREF_RULES,
  type MergedCharacter,
  type AnalysisWindow,
} from "../../src/core/character-analysis";

function pickJson(): { jsonPath: string; withAgent: boolean } {
  let withAgent = false;
  const args = process.argv.slice(2).filter((a) => {
    if (a === "--agent") {
      withAgent = true;
      return false;
    }
    return true;
  });
  const arg = args[0];
  if (arg && fs.existsSync(arg)) return { jsonPath: arg, withAgent };
  const dir = path.join("scripts", "eval", "results");
  const files = fs
    .readdirSync(dir)
    .filter((x) => x.startsWith("char-s1-") && x.endsWith(".json"))
    .map((x) => ({ x, t: fs.statSync(path.join(dir, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error("no char-s1 json");
  return { jsonPath: path.join(dir, files[0]!.x), withAgent };
}

function sur(c: { mentions: { surface: string }[] }): string {
  return Array.from(new Set(c.mentions.map((m) => m.surface).filter(Boolean))).join(
    "、",
  );
}

function label(c: MergedCharacter): string {
  return `${c.id}[g=${c.gender || "?"}|a=${c.age || "?"}|w=${c.windowLo}..${c.windowHi}]{${sur(c)}}`;
}

function readNovel(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  if ((text.match(/\uFFFD/g) || []).length > 5 || /Ã.|Â./.test(text.slice(0, 200))) {
    text = iconv.decode(buf, "gbk");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function fmtBreakdown(
  b: {
    ruleId: string;
    enabled: boolean;
    weight: number;
    delta: number;
    weighted: number;
    hard?: string;
    reason: string;
  }[],
  prior: number,
): string[] {
  const lines: string[] = [];
  lines.push(`  prior=${prior.toFixed(3)}`);
  let acc = prior;
  for (const r of b) {
    if (!r.enabled) {
      lines.push(`  [off] ${r.ruleId}`);
      continue;
    }
    acc += r.weighted;
    const hard = r.hard ? ` HARD=${r.hard}` : "";
    lines.push(
      `  ${r.ruleId}: w=${r.weight} × Δ=${r.delta.toFixed(3)} → ${r.weighted >= 0 ? "+" : ""}${r.weighted.toFixed(3)}${hard}`,
    );
    lines.push(`      ${r.reason}`);
  }
  lines.push(
    `  => sum(prior+Σ)=${acc.toFixed(3)} clamp01 later; hard priority reject>merge`,
  );
  return lines;
}

async function main() {
  const { jsonPath, withAgent } = pickJson();
  console.log("using", jsonPath, withAgent ? "(with agent)" : "(rules only)");
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const characters = (j.stage2?.characters || []) as MergedCharacter[];
  if (!characters.length) throw new Error("no stage2.characters");

  const cfg = j.config || { windowChars: 6000, overlapChars: 800 };
  if (!j.source || !fs.existsSync(j.source)) {
    throw new Error(`source missing: ${j.source}`);
  }
  const text = readNovel(j.source);
  const windows: AnalysisWindow[] = buildAnalysisWindows(text, cfg);
  const config = mergeStage3Config({
    agentEnabled: withAgent,
  });

  // ── Full resolve (same as pipeline) ─────────────────────────────
  const llm = withAgent ? createLLMProvider("analysis") : null;
  const result = await resolveCorefWithRulesAndAgent(characters, windows, {
    llm,
    fullText: text,
    agentContextRadius: 220,
    config: { agentEnabled: withAgent },
    agentConcurrency: 4,
    onAgentPair: (info) => {
      process.stdout.write(
        `\r[agent] ${info.index + 1}/${info.total} ${info.idA}~${info.idB}   `,
      );
    },
  });
  if (withAgent) console.log("");

  const byId = new Map(characters.map((c) => [c.id, c]));
  const graph = buildCooccurGraph(characters, windows);

  // ── Stats by decision ───────────────────────────────────────────
  const lines: string[] = [];
  const push = (...xs: string[]) => {
    for (const x of xs) lines.push(x);
  };

  push("# Stage3 rules debug");
  push("");
  push(`- source json: \`${jsonPath}\``);
  push(`- stage2 characters: ${characters.length}`);
  push(`- pairs: ${result.pairCount}`);
  push(
    `- stats: autoMerge=${result.stats.autoMerge} autoReject=${result.stats.autoReject} agent=${result.stats.agent} agentMerge=${result.stats.agentMerge} agentReject=${result.stats.agentReject} agentSkipped=${result.stats.agentSkipped}`,
  );
  push(`- stage3 characters: ${result.characters.length}`);
  push(
    `- thresholds: autoMerge≥${config.autoMergeThreshold} autoReject≤${config.autoRejectThreshold} prior=${config.prior}`,
  );
  push("");
  push("## Rule registry (id / defaultWeight / description)");
  for (const r of ALL_COREF_RULES) {
    const over = config.rules[r.id];
    const w = over?.weight ?? r.defaultWeight;
    const en = over?.enabled ?? r.defaultEnabled;
    push(`- \`${r.id}\` w=${w} enabled=${en} — ${r.description}`);
  }

  // ── Aggregate: which rules fire on auto_merge ───────────────────
  const autoMerges = result.scored.filter((s) => s.decision === "auto_merge");
  const ruleHits = new Map<
    string,
    { n: number; sumWeighted: number; hardMerge: number; hardReject: number }
  >();
  for (const s of autoMerges) {
    for (const b of s.breakdown) {
      if (!b.enabled) continue;
      const st = ruleHits.get(b.ruleId) || {
        n: 0,
        sumWeighted: 0,
        hardMerge: 0,
        hardReject: 0,
      };
      st.n++;
      st.sumWeighted += b.weighted;
      if (b.hard === "merge") st.hardMerge++;
      if (b.hard === "reject") st.hardReject++;
      ruleHits.set(b.ruleId, st);
    }
  }
  push("");
  push("## Rule hit stats on auto_merge pairs only");
  push("| rule | fires | sum(weighted) | avg(w) | hardMerge | hardReject |");
  push("|---|---:|---:|---:|---:|---:|");
  for (const r of ALL_COREF_RULES) {
    const st = ruleHits.get(r.id);
    if (!st) {
      push(`| ${r.id} | 0 | 0 | — | 0 | 0 |`);
      continue;
    }
    push(
      `| ${r.id} | ${st.n} | ${st.sumWeighted.toFixed(3)} | ${(st.sumWeighted / st.n).toFixed(3)} | ${st.hardMerge} | ${st.hardReject} |`,
    );
  }

  // soft vs hard among auto_merge
  const hardMergeN = autoMerges.filter((s) => s.hard === "merge").length;
  const softMergeN = autoMerges.filter((s) => s.hard == null).length;
  push("");
  push(
    `auto_merge split: hard_merge=${hardMergeN}, soft_score(≥threshold)=${softMergeN}`,
  );

  // ── Every auto_merge with full breakdown ────────────────────────
  push("");
  push("## All auto_merge pairs (full rule breakdown)");
  // sort: hard first, then by score desc
  const sortedAM = [...autoMerges].sort((a, b) => {
    const ha = a.hard === "merge" ? 0 : 1;
    const hb = b.hard === "merge" ? 0 : 1;
    if (ha !== hb) return ha - hb;
    return b.score - a.score;
  });
  for (const s of sortedAM) {
    const a = byId.get(s.idA)!;
    const b = byId.get(s.idB)!;
    const feat = buildPairFeatures(a, b, config, graph);
    push("");
    push(
      `### ${s.idA} ~ ${s.idB}  decision=${s.decision} score=${s.score.toFixed(3)} hard=${s.hard ?? "—"}`,
    );
    push(`- A: ${label(a)}`);
    push(`- B: ${label(b)}`);
    push(
      `- features: shared=[${feat.sharedSurfaces.join(",")}] strong=[${feat.sharedStrongSurfaces.join(",")}] ` +
        `exclA=[${feat.exclusiveStrongA.join(",")}] exclB=[${feat.exclusiveStrongB.join(",")}] ` +
        `genderConflict=${feat.genderConflict} windowGap=${feat.windowGap} ` +
        `S_excl=${feat.cooccurExclusivity.toFixed(3)} topX=${feat.topExclusiveCompanion ?? "—"} ` +
        `jacc=${feat.cooccurJaccard.toFixed(3)} sharedN=${feat.sharedNeighborCount} ` +
        `neverSameWin=${feat.neverSameWindow} sameWin=${feat.sameWindowCount}`,
    );
    for (const line of fmtBreakdown(s.breakdown, config.prior)) {
      push(line);
    }
  }

  // ── Agent merges ────────────────────────────────────────────────
  const agentMerges = result.scored.filter((s) => s.decision === "agent_merge");
  if (agentMerges.length) {
    push("");
    push("## Agent merges");
    for (const s of agentMerges) {
      const a = byId.get(s.idA)!;
      const b = byId.get(s.idB)!;
      push("");
      push(
        `### ${s.idA} ~ ${s.idB} score=${s.score.toFixed(3)} agent=${s.agentAnswer} ${s.agentReason || ""}`,
      );
      push(`- A: ${label(a)}`);
      push(`- B: ${label(b)}`);
      for (const line of fmtBreakdown(s.breakdown, config.prior)) {
        push(line);
      }
    }
  }

  // ── Reconstruct components from merge edges only ────────────────
  class UF {
    p = new Map<string, string>();
    add(x: string) {
      if (!this.p.has(x)) this.p.set(x, x);
    }
    find(x: string): string {
      this.add(x);
      const p = this.p.get(x)!;
      if (p !== x) {
        const r = this.find(p);
        this.p.set(x, r);
        return r;
      }
      return x;
    }
    union(a: string, b: string) {
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) this.p.set(ra, rb);
    }
  }
  const uf = new UF();
  for (const c of characters) uf.add(c.id);
  const mergeEdges = result.scored.filter(
    (s) => s.decision === "auto_merge" || s.decision === "agent_merge",
  );
  for (const e of mergeEdges) uf.union(e.idA, e.idB);

  const comps = new Map<string, string[]>();
  for (const c of characters) {
    const r = uf.find(c.id);
    const arr = comps.get(r) || [];
    arr.push(c.id);
    comps.set(r, arr);
  }
  const bigComps = [...comps.entries()]
    .map(([root, ids]) => ({ root, ids }))
    .filter((c) => c.ids.length > 1)
    .sort((a, b) => b.ids.length - a.ids.length);

  push("");
  push("## Connected components (size>1) after merges");
  for (const comp of bigComps) {
    push("");
    push(`### component size=${comp.ids.length} root=${comp.root}`);
    for (const id of comp.ids) {
      push(`- ${label(byId.get(id)!)}`);
    }
    // edges inside component
    const idSet = new Set(comp.ids);
    const edges = mergeEdges.filter(
      (e) => idSet.has(e.idA) && idSet.has(e.idB),
    );
    push("");
    push("#### merge edges in this component");
    for (const e of edges) {
      const a = byId.get(e.idA)!;
      const b = byId.get(e.idB)!;
      const excl = e.breakdown.find((x) => x.ruleId === "cooccur_exclusivity");
      const jacc = e.breakdown.find((x) => x.ruleId === "cooccur_jaccard");
      const strong = e.breakdown.find(
        (x) => x.ruleId === "shared_strong_surface",
      );
      const gender = e.breakdown.find((x) => x.ruleId === "gender_conflict");
      push(
        `- **${e.idA}~${e.idB}** ${e.decision} score=${e.score.toFixed(3)} hard=${e.hard ?? "—"} ` +
          `| ${sur(a)}  ↔  ${sur(b)}`,
      );
      push(
        `  excl=${excl ? `Δ=${excl.delta.toFixed(3)} wΔ=${excl.weighted.toFixed(3)} (${excl.reason})` : "—"} ` +
          `| jacc=${jacc ? `Δ=${jacc.delta.toFixed(3)} wΔ=${jacc.weighted.toFixed(3)}` : "—"} ` +
          `| strong=${strong ? `${strong.hard || "soft"} ${strong.reason}` : "—"} ` +
          `| gender=${gender ? gender.hard || gender.reason : "—"}`,
      );
    }
  }

  // ── Focus: pairs involving 我 that auto_merged ──────────────────
  push("");
  push("## Focus: auto_merge pairs involving surface 我");
  for (const s of autoMerges) {
    const a = byId.get(s.idA)!;
    const b = byId.get(s.idB)!;
    const hasWo =
      a.mentions.some((m) => m.surface === "我") ||
      b.mentions.some((m) => m.surface === "我");
    if (!hasWo) continue;
    const excl = s.breakdown.find((x) => x.ruleId === "cooccur_exclusivity");
    const jacc = s.breakdown.find((x) => x.ruleId === "cooccur_jaccard");
    push(
      `- ${s.idA}{${sur(a)}} ~ ${s.idB}{${sur(b)}} score=${s.score.toFixed(3)} hard=${s.hard ?? "—"} ` +
        `excl_wΔ=${excl ? excl.weighted.toFixed(3) : "0"} jacc_wΔ=${jacc ? jacc.weighted.toFixed(3) : "0"}`,
    );
  }

  // ── Soft-score near-threshold dump (would-be merges) ────────────
  const softNear = result.scored
    .filter(
      (s) =>
        s.hard == null &&
        s.score >= config.autoMergeThreshold - 0.1 &&
        s.score < config.autoMergeThreshold,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  push("");
  push(
    `## Soft scores in [${(config.autoMergeThreshold - 0.1).toFixed(2)}, ${config.autoMergeThreshold}) — near miss / agent zone (top 30)`,
  );
  for (const s of softNear) {
    const a = byId.get(s.idA)!;
    const b = byId.get(s.idB)!;
    const excl = s.breakdown.find((x) => x.ruleId === "cooccur_exclusivity");
    const jacc = s.breakdown.find((x) => x.ruleId === "cooccur_jaccard");
    push(
      `- ${s.idA}{${sur(a)}} ~ ${s.idB}{${sur(b)}} score=${s.score.toFixed(3)} dec=${s.decision} ` +
        `excl=${excl ? excl.weighted.toFixed(3) : "0"} jacc=${jacc ? jacc.weighted.toFixed(3) : "0"}`,
    );
  }

  // ── Final stage3 list ───────────────────────────────────────────
  push("");
  push("## Final stage3 characters");
  for (const c of result.characters) {
    push(`- ${c.id} w=[${c.windowLo}..${c.windowHi}] g=${c.gender || "?"} a=${c.age || "?"} {${sur(c)}} n=${c.mentions.length}`);
  }

  const outDir = path.join("scripts", "eval", "results");
  const mdPath = path.join(outDir, "_stage3-rules-debug.md");
  const jsonOut = path.join(outDir, "_stage3-rules-debug.json");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        source: jsonPath,
        stats: result.stats,
        characterCount: result.characters.length,
        autoMerges: sortedAM.map((s) => ({
          idA: s.idA,
          idB: s.idB,
          score: s.score,
          hard: s.hard,
          decision: s.decision,
          surfacesA: sur(byId.get(s.idA)!),
          surfacesB: sur(byId.get(s.idB)!),
          breakdown: s.breakdown,
          features: buildPairFeatures(
            byId.get(s.idA)!,
            byId.get(s.idB)!,
            config,
            graph,
          ),
        })),
        components: bigComps.map((c) => ({
          size: c.ids.length,
          members: c.ids.map((id) => ({
            id,
            surfaces: sur(byId.get(id)!),
            gender: byId.get(id)!.gender,
          })),
          edges: mergeEdges
            .filter((e) => c.ids.includes(e.idA) && c.ids.includes(e.idB))
            .map((e) => ({
              idA: e.idA,
              idB: e.idB,
              score: e.score,
              hard: e.hard,
              decision: e.decision,
              breakdown: e.breakdown,
            })),
        })),
        final: result.characters.map((c) => ({
          id: c.id,
          surfaces: sur(c),
          gender: c.gender,
          age: c.age,
          n: c.mentions.length,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(lines.join("\n"));
  console.log(`\n--- wrote ${mdPath}`);
  console.log(`--- wrote ${jsonOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
