import Database from "better-sqlite3";
import { scanCharacterCandidates } from "../src/core/extractor/character-candidates";

const db = new Database("data/novels.db");
const text = (
  db.prepare("SELECT text FROM novels WHERE id=?").get("novel_6p0987") as {
    text: string;
  }
).text;

const snip = "的，洛雪棠啊！洛雨棠才十岁。李志宇的下场。";
const c1 = scanCharacterCandidates(snip.repeat(30), {
  minCount: 2,
  maxCandidates: 20,
});
console.log(
  "snippet:",
  c1.map((c) => `${c.name}:${c.count}`).join(", "),
);

const t0 = Date.now();
const all = scanCharacterCandidates(text, { minCount: 2, maxCandidates: 500 });
console.log("full ms", Date.now() - t0, "n", all.length);

for (const n of [
  "洛雪棠",
  "洛雨棠",
  "李志宇",
  "李动",
  "赵芷然",
  "洛绍温",
  "唐兰嫣",
  "沈薇薇",
]) {
  const i = all.findIndex((c) => c.name === n);
  const c = all[i];
  if (i < 0) console.log(n, "MISSING");
  else
    console.log(
      n,
      "rank",
      i + 1,
      "count",
      c.count,
      "sc",
      c.score,
      "sp",
      c.speechHits,
      "span",
      c.spanBuckets,
      "src",
      c.sources.join("+"),
    );
}

// Is 洛 even recognized? Manual index count vs candidates containing 洛
console.log(
  "洛 names in top500:",
  all
    .filter((c) => c.name.includes("洛"))
    .slice(0, 20)
    .map((c) => c.name + ":" + c.count)
    .join(", "),
);
console.log(
  "李 names top20:",
  all
    .filter((c) => c.name.startsWith("李"))
    .slice(0, 20)
    .map((c) => c.name + ":" + c.count)
    .join(", "),
);
