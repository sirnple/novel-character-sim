/**
 * Debug program character candidate scan on a novel in SQLite.
 * Usage: npx tsx scripts/debug-char-scan.ts [novelIdOrTitleFragment]
 */
import Database from "better-sqlite3";
import {
  scanCharacterCandidates,
  formatCandidatesForPrompt,
} from "../src/core/extractor/character-candidates";

const arg = process.argv[2] || "绿帽武神";
const db = new Database("data/novels.db");

const row = db
  .prepare(
    `SELECT id, title, text FROM novels
     WHERE id = ? OR title LIKE ?
     ORDER BY length(text) DESC LIMIT 1`,
  )
  .get(arg, `%${arg}%`) as { id: string; title: string; text: string } | undefined;

if (!row) {
  console.error("novel not found:", arg);
  process.exit(1);
}

console.log("id:", row.id);
console.log("title:", row.title.slice(0, 60));
console.log("len:", row.text.length);

const probe = ["洛雪棠", "洛雨棠", "李志宇", "洛雪", "雨棠"];
for (const n of probe) {
  let c = 0;
  let i = 0;
  while ((i = row.text.indexOf(n, i)) !== -1) {
    c++;
    i += n.length;
  }
  console.log(`count ${n}: ${c}`);
  if (c > 0) {
    const idx = row.text.indexOf(n);
    const ctx = row.text.slice(Math.max(0, idx - 25), idx + n.length + 35).replace(/\s+/g, " ");
    console.log("  sample:", ctx);
  }
}

// How often does 洛雪棠 appear before speech verbs?
const speechAfter = (name: string, limit = 5) => {
  const re = new RegExp(
    name + "(.{0,8})(说|道|问|喊|笑|冷笑|说道|问道|笑道)",
    "g",
  );
  let m: RegExpExecArray | null;
  let hits = 0;
  const samples: string[] = [];
  while ((m = re.exec(row!.text)) !== null && hits < 50) {
    hits++;
    if (samples.length < limit) samples.push(m[0].replace(/\s+/g, " "));
  }
  return { hits, samples };
};

for (const n of ["洛雪棠", "洛雨棠", "李志宇"]) {
  const s = speechAfter(n);
  console.log(`speech-like after ${n}: ${s.hits}`, s.samples);
}

// What chars appear right after these names most?
function afterCharHist(name: string, topN = 15) {
  const hist = new Map<string, number>();
  let i = 0;
  while ((i = row!.text.indexOf(name, i)) !== -1) {
    const ch = row!.text[i + name.length] || "∅";
    hist.set(ch, (hist.get(ch) || 0) + 1);
    i += name.length;
  }
  return Array.from(hist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
}

for (const n of ["洛雪棠", "洛雨棠", "李志宇"]) {
  console.log(`after-char ${n}:`, afterCharHist(n));
}

const t0 = Date.now();
const cands = scanCharacterCandidates(row.text, { maxCandidates: 100 });
console.log("scan ms:", Date.now() - t0, "count:", cands.length);

const set = new Set(cands.map((c) => c.name));
for (const n of probe) {
  console.log("in candidates?", n, set.has(n));
}

console.log("\n--- top 50 ---");
cands.slice(0, 50).forEach((c, i) => {
  console.log(
    String(i + 1).padStart(2),
    c.name.padEnd(6),
    "sc=" + String(c.score).padStart(3),
    "n=" + c.count,
    "sp=" + c.speechHits,
    "span=" + c.spanBuckets,
    c.sources.join(","),
  );
});

console.log("\n洛*:", cands.filter((c) => c.name.includes("洛")).map((c) => c.name).join(", "));
console.log("李*:", cands.filter((c) => c.name.includes("李")).map((c) => c.name).join(", "));

// Check if 洛 is in SURNAME and refine would prefer 2-char
console.log("\n--- weak frequency of exact names ---");
for (const n of ["洛雪棠", "洛雨棠", "李志宇"]) {
  // how many times as 2-3 window starting at name
  console.log(n, "len", n.length);
}
