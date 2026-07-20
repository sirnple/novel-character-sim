/**
 * Force re-extract **character list (roster) only** into the **eval DB**,
 * then gold mustFind recall. Does NOT run character detail or relationships.
 * Does NOT write to the main app DB (data/novels.db).
 *
 * Eval DB: data/eval/novels.db
 * - If missing, copies main data/novels.db → eval once.
 * - If novel missing in eval, seeds that novel row from main (read-only).
 *
 *   npx tsx scripts/eval/reextract-user-gold.ts
 *   npx tsx scripts/eval/reextract-user-gold.ts yunie
 *   npx tsx scripts/eval/reextract-user-gold.ts lvmao
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { loadEnvLocal } from "../lib/load-env-local";
import {
  ensureEvalDb,
  useEvalDb,
  mainAppDbPath,
} from "../lib/use-eval-db";
import { seedNovelFromMainDb } from "../lib/seed-novel-into-eval-db";

loadEnvLocal();
// Always isolate: never default to main novels.db
ensureEvalDb();
useEvalDb({ force: true });

import {
  startCharacterExtractJob,
  getCharacterExtractJob,
} from "../../src/core/extractor/character-extract-job";
import { getCharacters, resolveDbPath } from "../../src/lib/db";

const ROOT = process.cwd();

const BOOKS: Record<
  string,
  { novelId: string; title: string; goldOnly: string }
> = {
  yunie: {
    novelId: "novel_ew7ku6",
    title: "欲孽灼心",
    goldOnly: "novel_ew7ku6",
  },
  lvmao: {
    novelId: "novel_6p0987",
    title: "超凡都市之绿帽武神",
    goldOnly: "novel_6p0987",
  },
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Find novel in current (eval) DB by id. */
function loadNovelFromCurrentDb(novelId: string): {
  id: string;
  title: string;
  user_id: string;
  text: string;
  total_length: number;
} | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const d = new Database(resolveDbPath(), { readonly: true });
  try {
    const row = d
      .prepare(
        "SELECT id, title, user_id, text, total_length FROM novels WHERE id = ? LIMIT 1",
      )
      .get(novelId) as
      | {
          id: string;
          title: string;
          user_id: string;
          text: string;
          total_length: number;
        }
      | undefined;
    return row?.text?.trim() ? row : null;
  } finally {
    d.close();
  }
}

/** Locate novel in main DB (any owner) for seeding into eval. */
function findNovelInMainDb(novelId: string): {
  user_id: string;
  title: string;
  text: string;
} | null {
  const mainPath = mainAppDbPath();
  if (!fs.existsSync(mainPath)) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const d = new Database(mainPath, { readonly: true });
  try {
    const row = d
      .prepare(
        "SELECT user_id, title, text FROM novels WHERE id = ? LIMIT 1",
      )
      .get(novelId) as
      | { user_id: string; title: string; text: string }
      | undefined;
    return row?.text?.trim() ? row : null;
  } finally {
    d.close();
  }
}

async function runOne(key: string) {
  const book = BOOKS[key];
  if (!book) throw new Error(`Unknown book ${key}`);

  let row = loadNovelFromCurrentDb(book.novelId);
  if (!row) {
    const main = findNovelInMainDb(book.novelId);
    if (!main) {
      console.error(
        `[${key}] novel ${book.novelId} not in eval DB (${resolveDbPath()}) or main (${mainAppDbPath()})`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[${key}] novel missing in eval — seed from main user=${main.user_id}`,
    );
    const seed = seedNovelFromMainDb({
      sourceUserId: main.user_id,
      sourceNovelId: book.novelId,
      destUserId: main.user_id,
      destNovelId: book.novelId,
      destTitle: book.title || main.title,
    });
    console.log(`  ${seed.message}`);
    if (!seed.ok) {
      process.exitCode = 1;
      return;
    }
    row = loadNovelFromCurrentDb(book.novelId);
  }

  if (!row?.text?.trim()) {
    console.error(`[${key}] empty text after seed for ${book.novelId}`);
    process.exitCode = 1;
    return;
  }

  const userId = row.user_id;
  console.log(
    `\n=== ${book.title} (${book.novelId}) userId=${userId} chars=${row.total_length || row.text.length} ===`,
  );
  console.log(`DB=${resolveDbPath()} (eval only; main untouched)`);

  console.log(
    `[1/2] Character roster extract (no detail/relationships) forceRefresh…`,
  );
  const job = startCharacterExtractJob({
    userId,
    novelId: book.novelId,
    forceRefresh: true,
    rosterOnly: true,
    text: row.text,
  });
  console.log(`  jobId=${job.id} units=${job.total} rosterOnly=true`);

  const t0 = Date.now();
  while (true) {
    const j = getCharacterExtractJob(job.id);
    if (!j) {
      console.error("job disappeared");
      process.exitCode = 1;
      return;
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    process.stdout.write(
      `\r  ${j.phase || j.status} ${j.completed}/${j.total} ${j.message || ""} (${elapsed}s)   `,
    );
    if (j.status === "done") {
      console.log("\n  job done");
      break;
    }
    if (j.status === "error" || j.status === "cancelled") {
      console.log("\n  job failed:", j.error || j.message);
      process.exitCode = 1;
      return;
    }
    await sleep(3000);
  }

  const chars = getCharacters(userId, book.novelId);
  console.log(`  characters saved: ${chars.length}`);
  console.log(
    `  sample: ${chars
      .map((c) => c.name)
      .slice(0, 25)
      .join("、")}`,
  );
  const longFace = chars.find(
    (c) =>
      c.name.includes("长脸") ||
      (c.aliases || []).some((a) => a.includes("长脸")),
  );
  console.log(
    `  长脸大叔 in roster? ${longFace ? `YES name=${longFace.name} aliases=${(longFace.aliases || []).join(",")}` : "NO"}`,
  );

  console.log(
    `[2/2] Gold eval (eval DB) --only=${book.goldOnly} --userId=${userId}`,
  );
  execSync(
    `npx tsx scripts/eval-character-name-scan.ts --only=${book.goldOnly} --userId=${userId}`,
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NCS_DB_PATH: resolveDbPath() },
    },
  );
}

async function main() {
  console.log(`[reextract-user-gold] eval DB=${resolveDbPath()}`);
  console.log(`[reextract-user-gold] main DB=${mainAppDbPath()} (read-only seed source)`);

  const arg = (process.argv[2] || "yunie").toLowerCase();
  const keys = arg === "all" ? Object.keys(BOOKS) : [arg];
  for (const k of keys) {
    if (!BOOKS[k]) {
      console.error("Use: yunie | lvmao | all");
      process.exitCode = 1;
      return;
    }
    await runOne(k);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
