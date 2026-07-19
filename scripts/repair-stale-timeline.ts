/**
 * Clear timeline rows whose chapter count ≠ branch chapter catalog.
 * User should re-run analysis (timeline module) to rebuild.
 */
import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "novels.db"));
const novelId = process.argv[2] || "novel_bnf7gh";

const metas = db
  .prepare(
    `SELECT user_id, branch_id, data FROM branch_chapter_meta WHERE novel_id = ?`,
  )
  .all(novelId) as { user_id: string; branch_id: string; data: string }[];

const catByKey = new Map<string, number>();
for (const m of metas) {
  const d = JSON.parse(m.data);
  catByKey.set(`${m.user_id}\0${m.branch_id}`, (d.chapters || []).length);
}

const tls = db
  .prepare(
    `SELECT user_id, branch_id, data FROM timelines WHERE novel_id = ?`,
  )
  .all(novelId) as { user_id: string; branch_id: string; data: string }[];

let cleared = 0;
for (const t of tls) {
  const d = JSON.parse(t.data);
  const tlN = d.chapters?.length || 0;
  const catN = catByKey.get(`${t.user_id}\0${t.branch_id}`) ?? 0;
  console.log(
    t.user_id.slice(0, 12),
    t.branch_id,
    `timeline=${tlN} catalog=${catN}`,
  );
  if (catN > 0 && tlN > 0 && catN !== tlN) {
    const empty = {
      novelId,
      branchId: t.branch_id,
      totalChapters: 0,
      chapters: [],
    };
    db.prepare(
      `INSERT OR REPLACE INTO timelines (novel_id, user_id, branch_id, data) VALUES (?, ?, ?, ?)`,
    ).run(novelId, t.user_id, t.branch_id, JSON.stringify(empty));
    cleared++;
    console.log("  → cleared stale timeline");
  }
}
console.log("cleared", cleared, "— re-run 分析 with timeline (or force refresh)");
