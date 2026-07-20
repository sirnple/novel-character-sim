/**
 * Isolate eval from the app main DB (data/novels.db).
 *
 * Call **before** any getDb() / saveCharacters / import:
 *   import { loadEnvLocal } from "./load-env-local";
 *   import { useEvalDb, ensureEvalDb } from "./use-eval-db";
 *   loadEnvLocal();
 *   ensureEvalDb(); // copy main → eval if eval missing
 *   useEvalDb();
 *
 * Path: data/eval/novels.db (override with NCS_DB_PATH only after ensure/use)
 * (data/ is gitignored)
 */
import path from "node:path";
import fs from "node:fs";

export const DEFAULT_EVAL_DB_REL = path.join("data", "eval", "novels.db");

export function resolveEvalDbPath(cwd = process.cwd()): string {
  const fromEnv = (process.env.NCS_DB_PATH || process.env.NOVEL_DB_PATH || "").trim();
  if (fromEnv) {
    // If env still points at main app DB, prefer isolated eval path for resolve
    // helpers that want the true eval file location.
    const abs = path.isAbsolute(fromEnv) ? fromEnv : path.join(cwd, fromEnv);
    if (!/eval[/\\]novels\.db$/i.test(abs) && /[/\\]data[/\\]novels\.db$/i.test(abs)) {
      return path.join(cwd, DEFAULT_EVAL_DB_REL);
    }
    return abs;
  }
  return path.join(cwd, DEFAULT_EVAL_DB_REL);
}

/** Main app DB path (never for eval writes). */
export function mainAppDbPath(cwd = process.cwd()): string {
  return path.join(cwd, "data", "novels.db");
}

/**
 * Ensure `data/eval/novels.db` exists.
 * If missing, copy from main `data/novels.db` (full file copy).
 * Does not overwrite an existing eval DB unless `forceCopy: true`.
 */
export function ensureEvalDb(opts?: {
  cwd?: string;
  /** Overwrite eval DB with a fresh copy of main (default false) */
  forceCopy?: boolean;
}): string {
  const cwd = opts?.cwd || process.cwd();
  const evalPath = path.join(cwd, DEFAULT_EVAL_DB_REL);
  const mainPath = mainAppDbPath(cwd);
  const dir = path.dirname(evalPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const missing = !fs.existsSync(evalPath);
  if (missing || opts?.forceCopy) {
    if (!fs.existsSync(mainPath)) {
      throw new Error(
        `[eval-db] main DB missing (${mainPath}); cannot ${missing ? "create" : "refresh"} eval DB`,
      );
    }
    fs.copyFileSync(mainPath, evalPath);
    const size = fs.statSync(evalPath).size;
    console.log(
      `[eval-db] ${missing ? "created" : "refreshed"} eval DB from main → ${evalPath} (${size} bytes)`,
    );
  } else {
    console.log(`[eval-db] using existing eval DB → ${evalPath}`);
  }
  return evalPath;
}

/**
 * Point the process at the eval SQLite file.
 * Call ensureEvalDb() first if the file may not exist yet.
 * Does not open the DB; first getDb() will open/create schema under data/eval/.
 */
export function useEvalDb(opts?: { force?: boolean; ensure?: boolean }): string {
  if (opts?.ensure !== false) {
    // Default: create eval from main when missing (safe for gold scripts)
    try {
      ensureEvalDb();
    } catch (e) {
      // No main DB yet — still point at eval path; getDb may create empty schema
      console.warn(
        `[eval-db] ensure skipped: ${(e as Error).message}`,
      );
    }
  }

  const target = path.join(process.cwd(), DEFAULT_EVAL_DB_REL);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (
    !opts?.force &&
    process.env.NCS_DB_PATH &&
    process.env.NCS_DB_PATH !== target &&
    /eval[/\\]novels\.db$/i.test(process.env.NCS_DB_PATH)
  ) {
    const existing = process.env.NCS_DB_PATH;
    console.log(`[eval-db] using pre-set NCS_DB_PATH=${existing}`);
    return path.isAbsolute(existing)
      ? existing
      : path.join(process.cwd(), existing);
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
