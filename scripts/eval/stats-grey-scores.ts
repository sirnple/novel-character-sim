/**
 * Grey-zone (agent path) score distribution from a char-s1 result JSON.
 *
 *   npx tsx scripts/eval/stats-grey-scores.ts
 *   npx tsx scripts/eval/stats-grey-scores.ts path/to/result.json
 */
import fs from "node:fs";
import path from "node:path";

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

function stats(arr: number[]) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return s[lo]!;
    return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
  };
  return {
    n: s.length,
    min: s[0]!,
    max: s[s.length - 1]!,
    mean: sum / s.length,
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
  };
}

function main() {
  const jsonPath = pickJson();
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const scored = (j.stage3?.scored || []) as {
    score: number;
    decision: string;
    hard?: string | null;
  }[];
  const thrHi = j.stage3?.config?.autoMergeThreshold ?? 0.85;
  const thrLo = j.stage3?.config?.autoRejectThreshold ?? 0.4;

  // Pairs that entered agent path (grey zone after rules)
  const grey = scored.filter((s) => String(s.decision || "").startsWith("agent"));
  const scores = grey
    .map((s) => s.score)
    .filter((x) => typeof x === "number")
    .sort((a, b) => a - b);

  const byDec: Record<string, number> = {};
  for (const s of grey) {
    byDec[s.decision] = (byDec[s.decision] || 0) + 1;
  }

  const bins: [number, number][] = [
    [0.0, 0.15],
    [0.15, 0.25],
    [0.25, 0.35],
    [0.35, 0.45],
    [0.45, 0.55],
    [0.55, 0.65],
    [0.65, 0.75],
    [0.75, 0.85],
    [0.85, 1.01],
  ];

  const mergeScores = grey
    .filter((s) => s.decision === "agent_merge")
    .map((s) => s.score)
    .sort((a, b) => a - b);
  const rejectScores = grey
    .filter((s) => s.decision === "agent_reject")
    .map((s) => s.score)
    .sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push("# Grey-zone score distribution");
  lines.push("");
  lines.push(`- source: \`${jsonPath}\``);
  lines.push(
    `- thresholds: autoReject ≤ ${thrLo}  |  grey  |  autoMerge ≥ ${thrHi}`,
  );
  lines.push(`- total scored pairs: **${scored.length}**`);
  lines.push(`- grey (agent_*) pairs: **${scores.length}**`);
  lines.push(
    `- by decision: ${Object.entries(byDec)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ")}`,
  );
  lines.push("");
  lines.push("## Summary (all grey scores)");
  const all = stats(scores);
  if (all) {
    lines.push(
      `| n | min | p10 | p25 | **p50** | p75 | p90 | max | mean |`,
    );
    lines.push(`|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
    lines.push(
      `| ${all.n} | ${all.min.toFixed(3)} | ${all.p10.toFixed(3)} | ${all.p25.toFixed(3)} | **${all.p50.toFixed(3)}** | ${all.p75.toFixed(3)} | ${all.p90.toFixed(3)} | ${all.max.toFixed(3)} | ${all.mean.toFixed(3)} |`,
    );
  }

  lines.push("");
  lines.push("## Histogram (bin width 0.1)");
  lines.push("| range | n | % | bar |");
  lines.push("|---|---:|---:|---|");
  const maxN = Math.max(1, ...bins.map(([a, b]) => scores.filter((s) => s >= a && s < b).length));
  for (const [a, b] of bins) {
    const n = scores.filter((s) => s >= a && s < b).length;
    if (n === 0 && (b <= thrLo || a >= thrHi)) continue;
    const pct = scores.length ? ((100 * n) / scores.length).toFixed(1) : "0";
    const bar = "█".repeat(Math.round((n / maxN) * 30));
    lines.push(`| [${a}, ${b}) | ${n} | ${pct}% | ${bar} |`);
  }

  lines.push("");
  lines.push("## agent_merge vs agent_reject by score bin");
  lines.push("| range | n | merge | reject | merge% |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [a, b] of bins) {
    const g = grey.filter((s) => s.score >= a && s.score < b);
    if (!g.length) continue;
    const m = g.filter((s) => s.decision === "agent_merge").length;
    const r = g.filter((s) => s.decision === "agent_reject").length;
    lines.push(
      `| [${a}, ${b}) | ${g.length} | ${m} | ${r} | ${((100 * m) / g.length).toFixed(1)}% |`,
    );
  }

  const ms = stats(mergeScores);
  const rs = stats(rejectScores);
  lines.push("");
  lines.push("## agent_merge score stats");
  if (ms) {
    lines.push(
      `n=${ms.n} min=${ms.min.toFixed(3)} p50=${ms.p50.toFixed(3)} mean=${ms.mean.toFixed(3)} max=${ms.max.toFixed(3)}`,
    );
  } else lines.push("(none)");
  lines.push("");
  lines.push("## agent_reject score stats");
  if (rs) {
    lines.push(
      `n=${rs.n} min=${rs.min.toFixed(3)} p50=${rs.p50.toFixed(3)} mean=${rs.mean.toFixed(3)} max=${rs.max.toFixed(3)}`,
    );
  } else lines.push("(none)");

  // also rule-score grey by soft band only (no hard), for comparison
  const softGrey = scored.filter(
    (s) =>
      !s.hard &&
      s.score > thrLo &&
      s.score < thrHi,
  );
  lines.push("");
  lines.push(
    `## Soft-only grey band (${thrLo} < score < ${thrHi}, no hard): n=${softGrey.length}`,
  );
  const softStats = stats(softGrey.map((s) => s.score));
  if (softStats) {
    lines.push(
      `p50=${softStats.p50.toFixed(3)} mean=${softStats.mean.toFixed(3)} min=${softStats.min.toFixed(3)} max=${softStats.max.toFixed(3)}`,
    );
  }

  const out = path.join("scripts", "eval", "results", "_stage3-grey-score-dist.md");
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\n--- wrote ${out}`);
}

main();
