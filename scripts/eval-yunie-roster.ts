/**
 * 欲孽灼心 eval（隔离 DB）:
 *   LLM unit 扫名 + analyze_character_list → 写 roster → gold eval
 *
 *   npx tsx scripts/eval-yunie-roster.ts
 *
 * 写入 data/eval/novels.db，不碰 data/novels.db（主库只读复制正文）。
 */
import { execSync } from "node:child_process";
import { loadEnvLocal } from "./lib/load-env-local";
import { useEvalDb } from "./lib/use-eval-db";

loadEnvLocal();
useEvalDb();

import { createLLMProvider } from "../src/core/llm/factory";
import { initRegistry } from "../src/core/agents/init";
import { getAgent } from "../src/core/agents/agent-registry";
import { getCharacterExtractWorkspace } from "../src/core/extractor/character-extract-workspace";
import { entitiesToProfiles } from "../src/core/agents/agents/character-extract-tools";
import {
  getBranchProse,
  getNovel,
  saveCharacters,
  getCharacters,
} from "../src/lib/db";
import { seedNovelFromMainDb } from "./lib/seed-novel-into-eval-db";
import { resolveDbPath } from "../src/lib/db";

/** Eval-only identity — never guest / production user */
const USER = "eval";
/** Same novel id as gold json so eval-character-name-scan --only matches */
const NOVEL = "novel_ew7ku6";
const BRANCH = "main";
/** Where the live book text lives in main DB (read-only seed source) */
const MAIN_USER = "guest_b2e7023ce0bf4198b25e5dd536830c4e";
const MAIN_NOVEL = "novel_ew7ku6";

async function main() {
  console.log(`[eval] DB=${resolveDbPath()}`);

  const seed = seedNovelFromMainDb({
    sourceUserId: MAIN_USER,
    sourceNovelId: MAIN_NOVEL,
    destUserId: USER,
    destNovelId: NOVEL,
    destTitle: "欲孽灼心",
  });
  console.log(`[1/3] ${seed.message}`);
  if (!seed.ok) {
    process.exitCode = 1;
    return;
  }

  initRegistry();
  const novel = getNovel(USER, NOVEL);
  const { text } = getBranchProse(USER, NOVEL, BRANCH);
  const full = text || novel?.text || "";
  console.log(`  title=${novel?.title} len=${full.length} user=${USER}`);

  const llm = createLLMProvider("analysis");
  const agent = getAgent("analyze_character_list");
  if (!agent) throw new Error("analyze_character_list not registered");

  console.log("[2/3] analyze_character_list (LLM unit scan + entity resolve)...");
  const t0 = Date.now();
  const result = await agent.execute(
    {
      prompt: `novelId=${NOVEL}\nbranchId=${BRANCH}`,
      novelId: NOVEL,
      branchId: BRANCH,
      userId: USER,
    },
    llm,
    (chunk) => {
      if (chunk.includes("\n") || chunk.length > 80) process.stdout.write(".");
    },
  );
  console.log(`\n  agent done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("  result:", result.content.slice(0, 400));

  const entities =
    getCharacterExtractWorkspace(USER, NOVEL, BRANCH)?.entities || [];
  const catalogN =
    getCharacterExtractWorkspace(USER, NOVEL, BRANCH)?.catalog?.stats?.length ||
    0;
  console.log(`  catalog surfaces=${catalogN} entities=${entities.length}`);
  console.log(
    "  names:",
    entities.map((e) => e.name).join("、") || "(none)",
  );

  if (!entities.length) {
    console.error("No entities — abort eval");
    process.exitCode = 1;
    return;
  }

  saveCharacters(USER, NOVEL, entitiesToProfiles(entities) as any);
  console.log(`  saved roster=${getCharacters(USER, NOVEL).length} → eval DB only`);

  console.log("[3/3] gold eval (same isolated DB)...");
  execSync(
    `npx tsx scripts/eval-character-name-scan.ts --only=${NOVEL} --userId=${USER}`,
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, NCS_DB_PATH: process.env.NCS_DB_PATH },
    },
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
