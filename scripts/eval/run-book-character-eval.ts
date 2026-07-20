/**
 * Import public classic (if needed) → start character unit-scan job → wait → gold eval.
 * All writes go to data/eval/novels.db (isolated from app main DB).
 *
 * Records git codeVersion inside eval report (via eval-character-name-scan).
 *
 *   npx tsx scripts/eval/run-book-character-eval.ts xiyouji
 */
import { execSync } from "node:child_process";
import { loadEnvLocal } from "../lib/load-env-local";
import { useEvalDb } from "../lib/use-eval-db";

loadEnvLocal();
useEvalDb();

import {
  startCharacterExtractJob,
  getCharacterExtractJob,
} from "../../src/core/extractor/character-extract-job";
import { getCharacters, getNovel, resolveDbPath } from "../../src/lib/db";

const ROOT = process.cwd();
const USER = "eval";

const BOOKS: Record<
  string,
  { novelId: string; title: string; goldOnly: string }
> = {
  xiyouji: {
    novelId: "public_xiyouji",
    title: "西游记",
    goldOnly: "public_xiyouji",
  },
  hongloumeng: {
    novelId: "public_hongloumeng",
    title: "红楼梦",
    goldOnly: "public_hongloumeng",
  },
  sanguoyanyi: {
    novelId: "public_sanguoyanyi",
    title: "三国演义",
    goldOnly: "public_sanguoyanyi",
  },
  shuihuzhuan: {
    novelId: "public_shuihuzhuan",
    title: "水浒传",
    goldOnly: "public_shuihuzhuan",
  },
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const slug = process.argv[2] || "xiyouji";
  const book = BOOKS[slug];
  if (!book) {
    console.error("Unknown book. Use:", Object.keys(BOOKS).join(", "));
    process.exitCode = 1;
    return;
  }

  console.log(`[eval] DB=${resolveDbPath()}`);

  // 1) Import text into isolated eval DB
  console.log(`[1/3] Import ${book.title}...`);
  execSync(`npx tsx scripts/eval/import-public-novel.ts ${slug} --userId=${USER}`, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NCS_DB_PATH: process.env.NCS_DB_PATH },
  });

  const novel = getNovel(USER, book.novelId);
  if (!novel?.text?.trim()) {
    console.error("Import failed — no text in DB");
    process.exitCode = 1;
    return;
  }
  console.log(`  text length=${novel.text.length}`);

  // 2) Character roster only (gold compares mustFind names, not detail/rels)
  console.log(`[2/3] Start character roster extract (forceRefresh, rosterOnly)...`);
  const job = startCharacterExtractJob({
    userId: USER,
    novelId: book.novelId,
    forceRefresh: true,
    rosterOnly: true,
    text: novel.text,
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

  const chars = getCharacters(USER, book.novelId);
  console.log(`  characters saved: ${chars.length}`);
  console.log(`  names: ${chars.map((c) => c.name).slice(0, 20).join("、")}...`);

  // 3) Eval with version stamp
  console.log(`[3/3] Gold eval --only=${book.goldOnly} --include-public...`);
  execSync(
    `npx tsx scripts/eval-character-name-scan.ts --include-public --only=${book.goldOnly} --userId=${USER}`,
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NCS_DB_PATH: process.env.NCS_DB_PATH },
    },
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
