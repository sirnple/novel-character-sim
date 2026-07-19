/**
 * Import a public-novel txt into the **eval** DB under a fixed id.
 *
 *   npx tsx scripts/eval/import-public-novel.ts xiyouji
 *   npx tsx scripts/eval/import-public-novel.ts hongloumeng --userId=eval
 *
 * Writes data/eval/novels.db (not data/novels.db).
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../lib/load-env-local";
import { useEvalDb } from "../lib/use-eval-db";

loadEnvLocal();
useEvalDb();

import { saveNovel, ensureMainBranch, getBranchProse, resolveDbPath } from "../../src/lib/db";

const SLUG_MAP: Record<string, { file: string; id: string; title: string }> = {
  xiyouji: {
    file: "xiyouji.txt",
    id: "public_xiyouji",
    title: "西游记",
  },
  hongloumeng: {
    file: "hongloumeng.txt",
    id: "public_hongloumeng",
    title: "红楼梦",
  },
  sanguoyanyi: {
    file: "sanguoyanyi.txt",
    id: "public_sanguoyanyi",
    title: "三国演义",
  },
  shuihuzhuan: {
    file: "shuihuzhuan.txt",
    id: "public_shuihuzhuan",
    title: "水浒传",
  },
};

function main() {
  const slug = process.argv[2];
  if (!slug || !SLUG_MAP[slug]) {
    console.error("Usage: npx tsx scripts/eval/import-public-novel.ts <slug>");
    console.error("slugs:", Object.keys(SLUG_MAP).join(", "));
    process.exitCode = 1;
    return;
  }
  let userId = "eval";
  for (const a of process.argv.slice(3)) {
    if (a.startsWith("--userId=")) userId = a.slice("--userId=".length);
  }
  const meta = SLUG_MAP[slug];
  const txtPath = path.join(process.cwd(), "data", "public-novels", meta.file);
  if (!fs.existsSync(txtPath)) {
    console.error("Missing text file:", txtPath);
    console.error("Run download first or place txt under data/public-novels/");
    process.exitCode = 1;
    return;
  }
  const text = fs.readFileSync(txtPath, "utf-8");
  saveNovel(userId, meta.id, meta.title, text);
  ensureMainBranch(userId, meta.id);
  const prose = getBranchProse(userId, meta.id, "main");
  console.log(
    `Imported ${meta.title} id=${meta.id} userId=${userId} chars=${prose.text.length} db=${resolveDbPath()}`,
  );
}

main();
