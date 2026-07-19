import Database from "better-sqlite3";
import path from "path";
import { matchChapterLine, loadChapterRules } from "../src/core/form/chapter-rules";
import { extractChapterCatalog } from "../src/core/form/chapter-catalog";

const db = new Database(path.join(process.cwd(), "data", "novels.db"), {
  readonly: true,
});

const row = db
  .prepare(`SELECT text, title FROM novels WHERE id = ?`)
  .get("novel_bnf7gh") as { text: string; title: string };

const text = row.text;
const lines = text.split(/\n/);

// Find all lines starting with 【
const bracketLines = lines
  .map((l, i) => ({ i, l: l.trim() }))
  .filter(({ l }) => l.startsWith("【"));
console.log("All bracket lines:", bracketLines.length);
for (const b of bracketLines) {
  const m = matchChapterLine(b.l);
  console.log({
    line: b.i,
    len: b.l.length,
    text: b.l,
    match: m
      ? { kind: m.kind, n: m.number, title: m.title, strength: m.strength }
      : null,
  });
}

// Check form in DB
const forms = db
  .prepare(`SELECT * FROM novel_form WHERE novel_id = ?`)
  .all("novel_bnf7gh");
console.log("\nnovel_form rows", forms.length);
for (const f of forms as any[]) {
  const keys = Object.keys(f);
  console.log("keys", keys);
  const jsonKey = keys.find((k) => k.includes("json") || k === "form" || k === "data");
  const payload = f.form_json || f.data || f.form || f.payload;
  if (payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    console.log(
      JSON.stringify(
        {
          chaptering: parsed.chaptering,
          catalogLen: parsed.chapterCatalog?.length ?? parsed.catalog?.length,
          catalog: (parsed.chapterCatalog || parsed.catalog || []).slice(0, 10),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify(f).slice(0, 800));
  }
}

const meta = db
  .prepare(`SELECT * FROM branch_chapter_meta WHERE novel_id = ?`)
  .all("novel_bnf7gh");
console.log("\nbranch_chapter_meta", meta.length);
for (const m of meta as any[]) {
  const raw = m.meta_json || m.chapters_json || m.data;
  if (raw) {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    console.log(
      "branch",
      m.branch_id,
      "chapters",
      Array.isArray(p.chapters) ? p.chapters.length : p,
    );
    if (p.chapters) {
      console.log(
        p.chapters.map((c: any) => ({
          n: c.number,
          t: c.title,
          s: c.startOffset,
        })),
      );
    }
  } else {
    console.log(Object.keys(m), JSON.stringify(m).slice(0, 500));
  }
}

console.log("rules", loadChapterRules().config.maxTitleLen);
console.log("catalog", extractChapterCatalog(text).map((c) => c.title));
