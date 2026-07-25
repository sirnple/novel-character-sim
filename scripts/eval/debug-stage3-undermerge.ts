/**
 * Analyze under-merged pairs from a stage1+2+3 JSON:
 * same-surface / alias candidates that did NOT end up in the same UF component.
 *
 *   npx tsx scripts/eval/debug-stage3-undermerge.ts path/to/char-s1-....json
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";

import {
  buildAnalysisWindows,
  buildCooccurGraph,
  buildPairFeatures,
  scorePair,
  decideByThresholds,
  mergeStage3Config,
  ALL_COREF_RULES,
  type MergedCharacter,
  type AnalysisWindow,
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

function sur(c: { mentions: { surface: string }[] }): string {
  return Array.from(
    new Set(c.mentions.map((m) => m.surface).filter(Boolean)),
  ).join("、");
}

function surSet(c: { mentions: { surface: string }[] }): Set<string> {
  return new Set(c.mentions.map((m) => m.surface).filter(Boolean));
}

function readNovel(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  if (
    (text.match(/\uFFFD/g) || []).length > 5 ||
    /Ã.|Â./.test(text.slice(0, 200))
  ) {
    text = iconv.decode(buf, "gbk");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Groups of surfaces that should ideally coref (undermerge audit keys). */
const ALIAS_GROUPS: { name: string; match: (s: string) => boolean }[] = [
  { name: "我(叙述者)", match: (s) => s === "我" },
  { name: "灵儿", match: (s) => s.includes("灵儿") },
  { name: "阿东", match: (s) => s.includes("阿东") },
  { name: "妈妈", match: (s) => s === "妈妈" || s === "母亲" },
  { name: "爷爷", match: (s) => s.includes("爷爷") },
  {
    name: "父亲/爸爸",
    match: (s) => s === "父亲" || s === "爸爸" || s === "爸",
  },
  {
    name: "小星/黎星",
    match: (s) =>
      /小星|黎星|老师/.test(s) && !/憔悴|男同事|钱德勒/.test(s),
  },
  {
    name: "加代子",
    match: (s) => /加代子|山彬/.test(s),
  },
  {
    name: "小女孩",
    match: (s) => /小女孩|女孩/.test(s) && !/灵儿|梦娜/.test(s),
  },
  {
    name: "老者",
    match: (s) => /老者|老人/.test(s) && !/爷爷/.test(s),
  },
  {
    name: "将军/空军少将",
    match: (s) => /将军|空军少将|一名空军/.test(s),
  },
  {
    name: "瘦弱的男人",
    match: (s) => /瘦弱|亲爱的/.test(s),
  },
];

function main() {
  const jsonPath = pickJson();
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const characters = (j.stage2?.characters || []) as MergedCharacter[];
  if (!characters.length) throw new Error("no stage2.characters");

  const cfg = j.config || { windowChars: 6000, overlapChars: 800 };
  if (!j.source || !fs.existsSync(j.source)) {
    throw new Error(`source missing: ${j.source}`);
  }
  const text = readNovel(j.source);
  const windows: AnalysisWindow[] = buildAnalysisWindows(text, cfg);
  const config = mergeStage3Config({ agentEnabled: false });
  const graph = buildCooccurGraph(characters, windows);

  // Rebuild decisions for every pair (same as stage3 rules pass)
  type Row = {
    idA: string;
    idB: string;
    score: number;
    hard: "merge" | "reject" | null;
    decision: string;
    breakdown: {
      ruleId: string;
      weight: number;
      delta: number;
      weighted: number;
      hard?: string;
      reason: string;
      enabled: boolean;
    }[];
    features: ReturnType<typeof buildPairFeatures>;
  };
  const byPair = new Map<string, Row>();
  const byId = new Map(characters.map((c) => [c.id, c]));

  for (let i = 0; i < characters.length; i++) {
    for (let j2 = i + 1; j2 < characters.length; j2++) {
      const a = characters[i]!;
      const b = characters[j2]!;
      const features = buildPairFeatures(a, b, config, graph);
      const base = scorePair(
        {
          a,
          b,
          features,
          windows,
          fullTextLength: Math.max(...windows.map((w) => w.end)),
          config,
        },
        ALL_COREF_RULES,
      );
      const decision = decideByThresholds(base, config);
      const key = [a.id, b.id].sort().join("~");
      byPair.set(key, {
        idA: a.id,
        idB: b.id,
        score: base.score,
        hard: base.hard,
        decision,
        breakdown: base.breakdown,
        features,
      });
    }
  }

  // UF from auto_merge only (rules-only; agent merges from saved JSON if present)
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
    same(a: string, b: string) {
      return this.find(a) === this.find(b);
    }
  }
  const uf = new UF();
  for (const c of characters) uf.add(c.id);

  // Prefer saved scored decisions if available (includes agent_merge)
  const saved = (j.stage3?.scored || []) as {
    idA: string;
    idB: string;
    decision: string;
  }[];
  if (saved.length) {
    for (const s of saved) {
      if (s.decision === "auto_merge" || s.decision === "agent_merge") {
        uf.union(s.idA, s.idB);
      }
    }
  } else {
    for (const r of byPair.values()) {
      if (r.decision === "auto_merge") uf.union(r.idA, r.idB);
    }
  }

  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  push("# Stage3 under-merge analysis");
  push("");
  push(`- source: \`${jsonPath}\``);
  push(
    `- thresholds: autoMerge≥${config.autoMergeThreshold} autoReject≤${config.autoRejectThreshold} prior=${config.prior}`,
  );
  push(
    `- sparse: minCount<${config.jaccardSparseMinCount} → excl **zero**, jaccard×${config.jaccardSparseDiscount}`,
  );
  push("");

  type Cand = {
    group: string;
    a: MergedCharacter;
    b: MergedCharacter;
    row: Row;
    alreadyMerged: boolean;
  };
  const cands: Cand[] = [];

  for (const g of ALIAS_GROUPS) {
    const members = characters.filter((c) =>
      [...surSet(c)].some((s) => g.match(s)),
    );
    for (let i = 0; i < members.length; i++) {
      for (let j2 = i + 1; j2 < members.length; j2++) {
        const a = members[i]!;
        const b = members[j2]!;
        const key = [a.id, b.id].sort().join("~");
        const row = byPair.get(key);
        if (!row) continue;
        cands.push({
          group: g.name,
          a,
          b,
          row,
          alreadyMerged: uf.same(a.id, b.id),
        });
      }
    }
  }

  const under = cands.filter((c) => !c.alreadyMerged);
  const ok = cands.filter((c) => c.alreadyMerged);

  push("## Summary by alias group");
  push("");
  push("| group | pairs | merged | under-merged | under decisions |");
  push("|---|---:|---:|---:|---|");
  for (const g of ALIAS_GROUPS) {
    const all = cands.filter((c) => c.group === g.name);
    if (!all.length) continue;
    const u = all.filter((c) => !c.alreadyMerged);
    const m = all.filter((c) => c.alreadyMerged);
    const dec = u
      .map((c) => `${c.row.decision}@${c.row.score.toFixed(2)}`)
      .join(", ");
    push(
      `| ${g.name} | ${all.length} | ${m.length} | ${u.length} | ${dec || "—"} |`,
    );
  }

  push("");
  push("## Under-merged pairs — full rule breakdown");
  push("");
  push(
    "Goal: these should land in **agent grey zone** " +
      `(${config.autoRejectThreshold} < score < ${config.autoMergeThreshold}) ` +
      "so LLM can judge; currently many are auto_reject or near-reject.",
  );

  // Sort: auto_reject first (worst), then agent, by group
  under.sort((x, y) => {
    const rank = (d: string) =>
      d === "auto_reject" ? 0 : d === "agent" ? 1 : 2;
    if (rank(x.row.decision) !== rank(y.row.decision)) {
      return rank(x.row.decision) - rank(y.row.decision);
    }
    if (x.group !== y.group) return x.group.localeCompare(y.group);
    return x.row.score - y.row.score;
  });

  for (const c of under) {
    const { a, b, row, group } = c;
    const f = row.features;
    push("");
    push(
      `### [${group}] ${a.id} ~ ${b.id}  → **${row.decision}** score=${row.score.toFixed(3)} hard=${row.hard ?? "—"}`,
    );
    push(
      `- A: ${a.id} w=[${a.windowLo}..${a.windowHi}] g=${a.gender || "?"} a=${a.age || "?"} {${sur(a)}}`,
    );
    push(
      `- B: ${b.id} w=[${b.windowLo}..${b.windowHi}] g=${b.gender || "?"} a=${b.age || "?"} {${sur(b)}}`,
    );
    push(
      `- features: shared=[${f.sharedSurfaces.join(",")}] strong=[${f.sharedStrongSurfaces.join(",")}] ` +
        `exclA=[${f.exclusiveStrongA.join(",")}] exclB=[${f.exclusiveStrongB.join(",")}] ` +
        `genderConflict=${f.genderConflict} windowGap=${f.windowGap} ` +
        `S_excl=${f.cooccurExclusivity.toFixed(3)} (raw=${f.cooccurExclusivityRaw.toFixed(3)}, sparse=${f.cooccurSparse}) ` +
        `jacc=${f.cooccurJaccard.toFixed(3)} sharedN=${f.sharedNeighborCount} ` +
        `neverSameWin=${f.neverSameWindow} appearA=${f.appearCountA} appearB=${f.appearCountB}`,
    );
    push(`- score path: prior=${config.prior}`);
    let acc = config.prior;
    for (const r of row.breakdown) {
      if (!r.enabled) continue;
      acc += r.weighted;
      const hard = r.hard ? ` HARD=${r.hard}` : "";
      push(
        `  - \`${r.ruleId}\`: w=${r.weight} × Δ=${r.delta.toFixed(3)} → **${r.weighted >= 0 ? "+" : ""}${r.weighted.toFixed(3)}**${hard}`,
      );
      push(`    ${r.reason}`);
    }
    push(
      `- ⇒ unclamped≈${acc.toFixed(3)} clamp01 score=${row.score.toFixed(3)} → **${row.decision}**`,
    );
    // Why not grey?
    if (row.decision === "auto_reject") {
      if (row.hard === "reject") {
        push(`- **why not grey:** hard reject (rule override)`);
      } else {
        push(
          `- **why not grey:** score ${row.score.toFixed(3)} ≤ autoReject ${config.autoRejectThreshold}`,
        );
      }
    } else if (row.decision === "agent") {
      push(
        `- **already grey:** should go to LLM (agentEnabled); check if agent rejected or skipped`,
      );
    } else if (row.decision === "auto_merge") {
      push(`- note: rules say auto_merge but UF says not merged? check agent path`);
    }
  }

  // Also check agent outcomes from saved JSON for under pairs that were agent
  if (saved.length) {
    const savedMap = new Map(
      saved.map((s) => [[s.idA, s.idB].sort().join("~"), s] as const),
    );
    push("");
    push("## Saved stage3 decisions for under-merged pairs");
    for (const c of under) {
      const key = [c.a.id, c.b.id].sort().join("~");
      const s = savedMap.get(key) as
        | { decision: string; score?: number; agentAnswer?: boolean; agentReason?: string }
        | undefined;
      if (!s) {
        push(`- ${c.group} ${c.a.id}~${c.b.id}: (not in saved scored — filtered?)`);
        continue;
      }
      push(
        `- **${c.group}** ${c.a.id}~${c.b.id}: saved=${s.decision}` +
          (s.score != null ? ` score=${s.score}` : "") +
          (s.agentAnswer != null ? ` agentSame=${s.agentAnswer}` : "") +
          (s.agentReason ? ` reason=${s.agentReason}` : ""),
      );
    }
  }

  push("");
  push("## Already correctly merged (same group, for contrast)");
  for (const c of ok) {
    push(
      `- [${c.group}] ${c.a.id}{${sur(c.a)}} ~ ${c.b.id}{${sur(c.b)}} ` +
        `score=${c.row.score.toFixed(3)} hard=${c.row.hard ?? "—"} dec=${c.row.decision}`,
    );
  }

  // Diagnosis patterns
  push("");
  push("## Pattern diagnosis");
  const ar = under.filter((c) => c.row.decision === "auto_reject");
  const ag = under.filter((c) => c.row.decision === "agent");
  push(`- under-merged total: **${under.length}**`);
  push(`- of which auto_reject: **${ar.length}** (never reach LLM)`);
  push(`- of which agent grey: **${ag.length}** (LLM path; if still separate → agent said no / skipped)`);

  // Common hard rejects
  const hardReasons = new Map<string, number>();
  for (const c of under) {
    for (const b of c.row.breakdown) {
      if (b.hard === "reject") {
        hardReasons.set(b.ruleId, (hardReasons.get(b.ruleId) || 0) + 1);
      }
    }
  }
  if (hardReasons.size) {
    push("- hard reject rules on under pairs:");
    for (const [k, n] of hardReasons) push(`  - ${k}: ${n}`);
  }

  // shared surface but still reject/agent
  const sharedButUnder = under.filter(
    (c) => c.row.features.sharedSurfaces.length > 0,
  );
  push(
    `- under pairs with **shared surface**: ${sharedButUnder.length} (these are highest-priority grey-zone candidates)`,
  );
  for (const c of sharedButUnder) {
    push(
      `  - [${c.group}] shared=[${c.row.features.sharedSurfaces.join(",")}] ` +
        `score=${c.row.score.toFixed(3)} → ${c.row.decision}`,
    );
  }

  const out = path.join(
    "scripts",
    "eval",
    "results",
    "_stage3-undermerge-analysis.md",
  );
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\n--- wrote ${out}`);
}

main();
