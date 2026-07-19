const Database = require("better-sqlite3");
const d = new Database("data/novels.db");
const tables = d
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((t) => t.name);
console.log("tables", tables);
try {
  const aws = d
    .prepare(
      "SELECT user_id, novel_id, branch_id, length(data) n, updated_at FROM analysis_workspace",
    )
    .all();
  console.log("analysis_workspace", aws);
  for (const r of aws) {
    const row = d
      .prepare(
        "SELECT data FROM analysis_workspace WHERE user_id=? AND novel_id=? AND branch_id=?",
      )
      .get(r.user_id, r.novel_id, r.branch_id);
    const j = JSON.parse(row.data);
    console.log({
      novel: r.novel_id,
      user: r.user_id,
      charsDraft: (j.charactersDraft || []).length,
      form: !!j.form,
      story: !!(j.storyInfo && j.storyInfo.plotSummary),
      sampleNames: (j.charactersDraft || []).slice(0, 5).map((c) => c.name),
    });
  }
} catch (e) {
  console.log("aws err", e.message);
}
console.log(
  "novels",
  d.prepare("SELECT user_id, id, title FROM novels ORDER BY updated_at DESC LIMIT 8").all(),
);
console.log(
  "char counts",
  d
    .prepare(
      "SELECT user_id, novel_id, count(*) c FROM characters GROUP BY user_id, novel_id",
    )
    .all(),
);
