/**
 * Copy a novel row (+ main branch prose) from main app DB into the current
 * process DB (must already be useEvalDb()). Uses a separate better-sqlite3
 * connection so we never open main via getDb().
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { mainAppDbPath } from "./use-eval-db";
import {
  saveNovel,
  ensureMainBranch,
  getNovel,
  getBranchProse,
  saveBranch,
  getBranch,
} from "../../src/lib/db";

export function seedNovelFromMainDb(opts: {
  sourceUserId: string;
  sourceNovelId: string;
  destUserId?: string;
  destNovelId?: string;
  destTitle?: string;
}): { ok: boolean; textLen: number; message: string } {
  const mainPath = mainAppDbPath();
  if (!fs.existsSync(mainPath)) {
    return { ok: false, textLen: 0, message: `main DB missing: ${mainPath}` };
  }

  const destUser = opts.destUserId || "eval";
  const destNovel = opts.destNovelId || opts.sourceNovelId;

  const main = new Database(mainPath, { readonly: true });
  try {
    const novel = main
      .prepare(
        `SELECT id, user_id, title, text FROM novels WHERE id = ? AND user_id = ?`,
      )
      .get(opts.sourceNovelId, opts.sourceUserId) as
      | { id: string; user_id: string; title: string; text: string }
      | undefined;

    let text = novel?.text || "";
    const title = opts.destTitle || novel?.title || opts.sourceNovelId;

    try {
      const br = main
        .prepare(
          `SELECT text FROM branches WHERE novel_id = ? AND id = 'main' AND user_id = ?`,
        )
        .get(opts.sourceNovelId, opts.sourceUserId) as { text?: string } | undefined;
      if (br?.text && br.text.length > text.length) text = br.text;
    } catch {
      /* ignore */
    }

    if (!text.trim()) {
      return {
        ok: false,
        textLen: 0,
        message: `no text for ${opts.sourceUserId}/${opts.sourceNovelId} in main DB`,
      };
    }

    saveNovel(destUser, destNovel, title, text);
    if (!getBranch(destUser, destNovel, "main")) {
      saveBranch(destUser, "main", destNovel, "主线", 0, text, {
        storage: "full",
        charCount: text.length,
      });
    } else {
      saveBranch(destUser, "main", destNovel, "主线", 0, text, {
        storage: "full",
        charCount: text.length,
      });
    }
    ensureMainBranch(destUser, destNovel);

    const check = getBranchProse(destUser, destNovel, "main");
    const n = (check.text || getNovel(destUser, destNovel)?.text || "").length;
    return {
      ok: n > 0,
      textLen: n,
      message: `seeded eval ${destUser}/${destNovel} title=${title} len=${n} from main ${opts.sourceUserId}/${opts.sourceNovelId}`,
    };
  } finally {
    main.close();
  }
}
