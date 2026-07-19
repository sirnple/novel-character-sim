/**
 * Isolate eval from the app main DB (data/novels.db).
 *
 * Call **before** any getDb() / saveCharacters / import:
 *   import { loadEnvLocal } from "./load-env-local";
 *   import { useEvalDb } from "./use-eval-db";
 *   loadEnvLocal();
 *   useEvalDb();
 *
 * Path: NCS_DB_PATH env, else data/eval/novels.db
 * (data/ is gitignored)
 */
import path from "node:path";
import fs from "node:fs";

export const DEFAULT_EVAL_DB_REL = path.join("data", "eval", "novels.db");

export function resolveEvalDbPath(cwd = process.cwd()): string {
  const fromEnv = (process.env.NCS_DB_PATH || process.env.NOVEL_DB_PATH || "").trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(cwd, fromEnv);
  }
  return path.join(cwd, DEFAULT_EVAL_DB_REL);
}

/**
 * Point the process at the eval SQLite file.
 * Does not open the DB; first getDb() will create schema under data/eval/.
 */
export function useEvalDb(opts?: { force?: boolean }): string {
  const target = resolveEvalDbPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!opts?.force && process.env.NCS_DB_PATH && process.env.NCS_DB_PATH !== target) {
    // Respect explicit override already set by caller/CI
    const existing = process.env.NCS_DB_PATH;
    console.log(`[eval-db] using pre-set NCS_DB_PATH=${existing}`);
    return path.isAbsolute(existing) ? existing : path.join(process.cwd(), existing);
  }

  process.env.NCS_DB_PATH = target;
  // Clear NOVEL_DB_PATH if it pointed at main, so resolveDbPath prefers NCS_
  if (
    process.env.NOVEL_DB_PATH &&
    /novels\.db$/i.test(process.env.NOVEL_DB_PATH) &&
    !process.env.NOVEL_DB_PATH.includes(`${path.sep}eval${path.sep}`)
  ) {
    delete process.env.NOVEL_DB_PATH;
  }
  console.log(`[eval-db] isolated DB → ${target}`);
  return target;
}

/** Main app DB path (never for eval writes). */
export function mainAppDbPath(cwd = process.cwd()): string {
  return path.join(cwd, "data", "novels.db");
}
