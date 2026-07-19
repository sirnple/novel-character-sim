import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "novels.db"), {
  readonly: true,
});

const novels = db
  .prepare(`SELECT id, title, length(text) as len FROM novels`)
  .all() as { id: string; title: string; len: number }[];
console.log(
  "novels",
  novels.map((n) => ({ id: n.id, title: String(n.title).slice(0, 40), len: n.len })),
);

const id =
  novels.find((n) => String(n.title).includes("欲孽") || n.id === "novel_bnf7gh")
    ?.id || novels[0]?.id;
if (!id) {
  console.log("no novel");
  process.exit(1);
}
console.log("\nfocus", id);

const forms = db
  .prepare(`SELECT user_id, data FROM novel_form WHERE novel_id = ?`)
  .all(id) as { user_id: string; data: string }[];
for (const f of forms) {
  const d = JSON.parse(f.data);
  console.log("form", f.user_id.slice(0, 12), {
    enabled: d.chaptering?.enabled,
    conf: d.chaptering?.confidence,
    pattern: d.chaptering?.titlePattern,
  });
}

const metas = db
  .prepare(
    `SELECT user_id, branch_id, data FROM branch_chapter_meta WHERE novel_id = ?`,
  )
  .all(id) as { user_id: string; branch_id: string; data: string }[];
for (const m of metas) {
  const d = JSON.parse(m.data);
  console.log(
    "catalog",
    m.user_id.slice(0, 12),
    m.branch_id,
    (d.chapters || []).length,
    (d.chapters || []).map((c: any) => c.number),
  );
}

const tls = db
  .prepare(`SELECT user_id, branch_id, data FROM timelines WHERE novel_id = ?`)
  .all(id) as { user_id: string; branch_id: string; data: string }[];
console.log("timelines rows", tls.length);
for (const t of tls) {
  const d = JSON.parse(t.data);
  console.log("tl", t.user_id.slice(0, 12), t.branch_id, {
    total: d.totalChapters,
    chapters: d.chapters?.length,
    titles: (d.chapters || []).map((c: any) => c.title || c.chapterNumber),
  });
}

const jobs = db
  .prepare(
    `SELECT id, user_id, branch_id, status, data, updated_at FROM timeline_jobs WHERE novel_id = ? ORDER BY updated_at DESC LIMIT 8`,
  )
  .all(id) as any[];
console.log("\njobs", jobs.length);
for (const j of jobs) {
  const d = typeof j.data === "string" ? JSON.parse(j.data) : {};
  console.log("---", j.id, j.status || d.status, j.updated_at);
  console.log({
    user: String(j.user_id).slice(0, 12),
    branch: j.branch_id || d.branchId,
    total: d.total,
    completed: d.completed,
    error: d.error,
    units: (d.units || []).map((u: any) => ({
      label: (u.label || "").slice(0, 28),
      st: u.status,
      err: (u.error || "").slice(0, 120),
    })),
  });
}

// generation logs
try {
  const logs = db
    .prepare(
      `SELECT label, output_preview, created_at FROM generation_logs WHERE novel_id = ? AND (label LIKE '%时间%' OR label LIKE '%timeline%' OR category='extract') ORDER BY created_at DESC LIMIT 10`,
    )
    .all(id) as any[];
  console.log("\nlogs", logs);
} catch (e) {
  console.log("logs skip", (e as Error).message);
}
