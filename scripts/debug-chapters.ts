import Database from "better-sqlite3";
import path from "path";
import {
  extractChapterCatalog,
  inferChapteringFromCatalog,
} from "../src/core/form/chapter-catalog";

const dbPath = path.join(process.cwd(), "data", "novels.db");
const db = new Database(dbPath, { readonly: true });

console.log(
  "tables",
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all(),
);

const cols = db.prepare(`PRAGMA table_info(novels)`).all();
console.log("novels cols", cols);

const novels = db
  .prepare(`SELECT id, title, length(text) as tlen FROM novels`)
  .all() as { id: string; title: string; tlen: number }[];
console.log("novels", novels);

const target =
  novels.find((n) => n.title?.includes("欲孽") || n.id?.includes("欲孽")) ||
  novels[0];
if (!target) {
  console.log("no novel");
  process.exit(1);
}
console.log("target", target);

const row = db
  .prepare(`SELECT text FROM novels WHERE id = ?`)
  .get(target.id) as { text: string };
const text = row?.text || "";
console.log("text length", text.length);

// Show first lines that look like headings
const lines = text.split(/\r?\n/);
console.log("total lines", lines.length);
const headingish = lines
  .map((l, i) => ({ i, l: l.trim() }))
  .filter(
    ({ l }) =>
      l.length > 0 &&
      l.length < 80 &&
      /(第|章|【|】|一、|二、|三、|卷|回|Chapter|\d+\.|[一二三四五六七八九十百千零〇两]+[、．.])/.test(
        l,
      ),
  )
  .slice(0, 40);
console.log("headingish samples:");
for (const h of headingish) {
  console.log(`  L${h.i}: ${JSON.stringify(h.l)}`);
}

// Also print first 80 non-empty short lines
console.log("\nfirst short lines:");
let shown = 0;
for (let i = 0; i < lines.length && shown < 60; i++) {
  const l = lines[i].trim();
  if (!l) continue;
  if (l.length > 100) {
    console.log(`  L${i}: ${JSON.stringify(l.slice(0, 80) + "…")} (len=${l.length})`);
  } else {
    console.log(`  L${i}: ${JSON.stringify(l)}`);
  }
  shown++;
}

const catalog = extractChapterCatalog(text);
console.log("\ncatalog count", catalog.length);
console.log(
  catalog.slice(0, 30).map((c) => ({
    n: c.number,
    title: c.title,
    offset: c.startOffset,
  })),
);
console.log("style", inferChapteringFromCatalog(text, catalog));
