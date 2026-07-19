/**
 * One-shot: re-scan 欲孽灼心 full text and fix main branch chapter meta + form samples.
 */
import Database from "better-sqlite3";
import path from "path";
import {
  extractChapterCatalog,
  inferChapteringFromCatalog,
} from "../src/core/form/chapter-catalog";

const NOVEL_ID = "novel_bnf7gh";
const db = new Database(path.join(process.cwd(), "data", "novels.db"));

const novels = db
  .prepare(`SELECT id, user_id, title, text FROM novels WHERE id = ?`)
  .all(NOVEL_ID) as { id: string; user_id: string; title: string; text: string }[];

if (!novels.length) {
  console.error("novel not found");
  process.exit(1);
}

for (const novel of novels) {
  const catalog = extractChapterCatalog(novel.text);
  const chaptering = inferChapteringFromCatalog(novel.text, catalog);
  console.log(novel.user_id, novel.title, "→", catalog.length, "chapters", chaptering);

  const metaRow = db
    .prepare(
      `SELECT data FROM branch_chapter_meta WHERE novel_id = ? AND branch_id = 'main' AND user_id = ?`,
    )
    .get(NOVEL_ID, novel.user_id) as { data: string } | undefined;

  const prev = metaRow?.data ? JSON.parse(metaRow.data) : {};
  const next = {
    ...prev,
    novelId: NOVEL_ID,
    branchId: "main",
    chapterBoundary: prev.chapterBoundary || "closed",
    chapters: catalog,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO branch_chapter_meta (novel_id, branch_id, user_id, data, updated_at)
     VALUES (?, 'main', ?, ?, datetime('now'))`,
  ).run(NOVEL_ID, novel.user_id, JSON.stringify(next));

  const formRow = db
    .prepare(`SELECT data FROM novel_form WHERE novel_id = ? AND user_id = ?`)
    .get(NOVEL_ID, novel.user_id) as { data: string } | undefined;
  if (formRow?.data) {
    const form = JSON.parse(formRow.data);
    form.chaptering = {
      ...form.chaptering,
      ...chaptering,
      enabled: chaptering.enabled,
      samples: chaptering.samples,
      confidence: Math.max(form.chaptering?.confidence ?? 0, chaptering.confidence),
    };
    form.unitHierarchy = {
      ...form.unitHierarchy,
      chapter: chaptering.enabled ? "present" : "weak",
    };
    form.updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE novel_form SET data = ?, updated_at = datetime('now') WHERE novel_id = ? AND user_id = ?`,
    ).run(JSON.stringify(form), NOVEL_ID, novel.user_id);
  }

  console.log(
    "  saved main chapters:",
    catalog.map((c) => `${c.number}:${c.title}`).join(" | "),
  );
}

console.log("done");
