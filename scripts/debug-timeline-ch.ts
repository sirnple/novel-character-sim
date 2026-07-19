import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "novels.db"), {
  readonly: true,
});

const id = "novel_bnf7gh";

console.log("=== branch_chapter_meta ===");
const metas = db
  .prepare(
    `SELECT user_id, branch_id, data FROM branch_chapter_meta WHERE novel_id = ?`,
  )
  .all(id) as { user_id: string; branch_id: string; data: string }[];
for (const m of metas) {
  const d = JSON.parse(m.data);
  console.log(m.user_id, m.branch_id, "n=", (d.chapters || []).length);
  console.log(
    (d.chapters || []).map(
      (c: { number?: number; title?: string; startOffset?: number; endOffset?: number }) => ({
        n: c.number,
        t: c.title,
        s: c.startOffset,
        e: c.endOffset,
      }),
    ),
  );
}

console.log("\n=== novel_form chaptering ===");
const forms = db
  .prepare(`SELECT user_id, data FROM novel_form WHERE novel_id = ?`)
  .all(id) as { user_id: string; data: string }[];
for (const f of forms) {
  const d = JSON.parse(f.data);
  console.log(f.user_id, d.chaptering);
}

console.log("\n=== timelines ===");
const tls = db
  .prepare(
    `SELECT user_id, branch_id, data FROM timelines WHERE novel_id = ?`,
  )
  .all(id) as { user_id: string; branch_id: string; data: string }[];
console.log("count", tls.length);
for (const t of tls) {
  const d = JSON.parse(t.data);
  console.log(
    t.user_id,
    t.branch_id,
    "totalChapters",
    d.totalChapters,
    "chapters.len",
    d.chapters?.length,
  );
  if (d.chapters) {
    console.log(
      d.chapters.map((c: { chapterNumber?: number; title?: string }) => ({
        n: c.chapterNumber,
        t: c.title,
      })),
    );
  }
}

console.log("\n=== timeline_jobs ===");
try {
  const jobs = db
    .prepare(`SELECT id, user_id, branch_id, status, data FROM timeline_jobs WHERE novel_id = ?`)
    .all(id) as any[];
  console.log("jobs", jobs.length);
  for (const j of jobs) {
    const d = typeof j.data === "string" ? JSON.parse(j.data) : j;
    console.log({
      id: j.id,
      status: j.status || d.status,
      total: d.total,
      completed: d.completed,
      units: (d.units || []).map((u: any) => ({
        label: u.label,
        st: u.status,
        s: u.startOffset,
      })),
    });
  }
} catch (e) {
  console.log("jobs err", (e as Error).message);
  console.log(db.prepare(`PRAGMA table_info(timeline_jobs)`).all());
}
