import Database from "better-sqlite3";
import path from "path";
import type {
  CharacterProfile, StoryInfo, SimulationState, ChapterTimeline, CharacterChapterState,
  StyleLibraryEntry, IdeaLibraryEntry, WritingStyle,
  NovelFormProfile, BranchChapterMeta, ChapterCatalogEntry,
} from "@/types";
import type { ForeshadowingLedger } from "@/core/foreshadowing/types";
import { emptyLedger } from "@/core/foreshadowing/types";
import type { ShareOverviewPayload, ShareVisibility } from "@/lib/share-payload";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin-users";

/** Default app DB. Override with NCS_DB_PATH or NOVEL_DB_PATH (absolute or cwd-relative). */
export function resolveDbPath(): string {
  const fromEnv = (process.env.NCS_DB_PATH || process.env.NOVEL_DB_PATH || "").trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "novels.db");
}

let db: Database.Database | null = null;
let dbPathOpened: string | null = null;

let migrated = false;

function getDb(): Database.Database {
  const DB_PATH = resolveDbPath();
  if (db && dbPathOpened && dbPathOpened !== DB_PATH) {
    throw new Error(
      `[DB] Already opened ${dbPathOpened}; cannot switch to ${DB_PATH} in the same process. ` +
        `Set NCS_DB_PATH before first DB access.`,
    );
  }
  if (!db) {
    const dir = path.dirname(DB_PATH);
    const fs = require("fs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    dbPathOpened = DB_PATH;
    db.pragma("journal_mode = WAL");
    initSchema(db);
    console.log(`[DB] open ${DB_PATH}`);
  }
  if (!migrated) {
    migrateOldData(db!);
    migrated = true;
  }
  return db;
}

/**
 * Clear character data that uses the old flat schema
 * (speakingStyle/background as strings).  New code expects nested objects.
 */
function ensureBranchColumn(
  d: Database.Database,
  name: string,
  ddl: string,
): void {
  const cols = d.prepare("PRAGMA table_info(branches)").all() as { name: string }[];
  if (!cols.some((c) => c.name === name)) {
    d.exec(`ALTER TABLE branches ADD COLUMN ${ddl}`);
    console.log(`[DB] branches: added column ${name}`);
  }
}

function migrateOldData(d: Database.Database): void {
  // Migrate branches table to (novel_id, id, user_id) PK so multiple novels can each have id="main".
  try {
    const cols = d.prepare("PRAGMA table_info(branches)").all() as { name: string }[];
    // Only rebuild if table exists and still has legacy PK shape (no novel_id in PK detection is hard;
    // keep prior migration once — if branches_old_pk missing and table has user_id, skip rebuild).
    if (cols.length > 0 && !cols.some((c) => c.name === "user_id")) {
      d.exec(`ALTER TABLE branches RENAME TO branches_old_pk`);
      d.exec(`
        CREATE TABLE branches (
          id TEXT NOT NULL,
          novel_id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'guest',
          name TEXT NOT NULL DEFAULT '',
          parent_offset INTEGER NOT NULL DEFAULT 0,
          text TEXT NOT NULL DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (novel_id, id, user_id)
        )
      `);
      d.exec(`
        INSERT INTO branches (id, novel_id, user_id, name, parent_offset, text, created_at, updated_at)
        SELECT id, novel_id, user_id, name, parent_offset, text, created_at, updated_at FROM branches_old_pk
      `);
      d.exec(`DROP TABLE branches_old_pk`);
      console.log("[DB] Migrated branches PK to (novel_id, id, user_id)");
    }
  } catch (e) {
    console.warn("[DB] branches migration skipped:", (e as Error).message);
  }

  // Phase 2 CoW columns (idempotent)
  try {
    ensureBranchColumn(d, "parent_branch_id", "parent_branch_id TEXT NOT NULL DEFAULT ''");
    ensureBranchColumn(d, "storage", "storage TEXT NOT NULL DEFAULT 'full'");
    ensureBranchColumn(d, "char_count", "char_count INTEGER NOT NULL DEFAULT 0");
    // Backfill char_count for rows still at 0
    d.exec(`
      UPDATE branches SET char_count = length(COALESCE(text, ''))
      WHERE char_count = 0 OR char_count IS NULL
    `);
  } catch (e) {
    console.warn("[DB] CoW columns migration skipped:", (e as Error).message);
  }

  // Branch-scoped timelines / chapter_states (legacy PK was novel_id+user_id only)
  migrateTimelineBranchScope(d);
  ensureTimelineJobsTable(d);

  const rows = d.prepare("SELECT id, data FROM characters").all() as { id: string; data: string }[];
  if (rows.length === 0) return;

  let needsClean = false;
  for (const row of rows) {
    try {
      const c = JSON.parse(row.data);
      // Old format: speakingStyle is a string, not an object
      if (typeof c.speakingStyle === "string") {
        needsClean = true;
        break;
      }
    } catch { needsClean = true; break; }
  }

  if (needsClean) {
    console.log("[DB] Old character data detected — clearing. Please re-extract characters.");
    d.prepare("DELETE FROM characters").run();
    d.prepare("DELETE FROM novels").run();
    d.prepare("DELETE FROM story_info").run();
  }
}

/** Rebuild timelines / chapter_states to include branch_id in PK. Existing rows → main. */
function migrateTimelineBranchScope(d: Database.Database): void {
  const rebuild = (table: "timelines" | "chapter_states") => {
    try {
      const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (cols.length === 0) return; // table not created yet
      if (cols.some((c) => c.name === "branch_id")) return;

      const v2 = `${table}_v2`;
      d.exec(`
        CREATE TABLE ${v2} (
          novel_id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'guest',
          branch_id TEXT NOT NULL DEFAULT 'main',
          data TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (novel_id, user_id, branch_id)
        );
        INSERT OR IGNORE INTO ${v2} (novel_id, user_id, branch_id, data, created_at)
          SELECT novel_id, user_id, 'main', data, created_at FROM ${table};
        DROP TABLE ${table};
        ALTER TABLE ${v2} RENAME TO ${table};
      `);
      console.log(`[DB] Migrated ${table} PK to (novel_id, user_id, branch_id)`);
    } catch (e) {
      console.warn(`[DB] ${table} branch_id migration skipped:`, (e as Error).message);
    }
  };
  rebuild("timelines");
  rebuild("chapter_states");
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      total_length INTEGER DEFAULT 0,
      language TEXT DEFAULT 'zh',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );

    CREATE TABLE IF NOT EXISTS story_info (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );

    CREATE TABLE IF NOT EXISTS simulations (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      novel_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      novel_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      user_id TEXT NOT NULL DEFAULT 'guest',
      character_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id);
    CREATE INDEX IF NOT EXISTS idx_simulations_novel ON simulations(novel_id);
    CREATE INDEX IF NOT EXISTS idx_simulations_user ON simulations(user_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_user ON scenes(user_id);
    CREATE INDEX IF NOT EXISTS idx_novels_user ON novels(user_id);
    
    CREATE TABLE IF NOT EXISTS generation_logs (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'guest',
      novel_id TEXT,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      input_summary TEXT,
      output_preview TEXT,
      full_output TEXT,
      token_estimate INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gen_logs_user ON generation_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_gen_logs_novel ON generation_logs(novel_id);
    CREATE INDEX IF NOT EXISTS idx_gen_logs_category ON generation_logs(category);

    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      novel_id TEXT NOT NULL DEFAULT '',
      branch_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL DEFAULT '',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_agent ON token_usage(agent_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_novel ON token_usage(novel_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_branch ON token_usage(branch_id);

    CREATE TABLE IF NOT EXISTS foreshadowing_ledgers (
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, novel_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS timelines (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      branch_id TEXT NOT NULL DEFAULT 'main',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS chapter_states (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      branch_id TEXT NOT NULL DEFAULT 'main',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS timeline_jobs (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_jobs_novel
      ON timeline_jobs (user_id, novel_id, branch_id, updated_at);

    CREATE TABLE IF NOT EXISTS agent_prompts (
      agent_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'extraction',
      system_prompt TEXT,
      user_prompt_template TEXT,
      is_modified INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, language)
    );
    CREATE TABLE IF NOT EXISTS codex_data (
      novel_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id)
    );

    CREATE TABLE IF NOT EXISTS novel_form (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS branch_chapter_meta (
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, branch_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      name TEXT NOT NULL DEFAULT '',
      parent_offset INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      parent_branch_id TEXT NOT NULL DEFAULT '',
      storage TEXT NOT NULL DEFAULT 'full',
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_branches_novel ON branches(novel_id);

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      parent_offset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_novel ON drafts(novel_id);

    CREATE TABLE IF NOT EXISTS style_library (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'extracted',
      source_novel_id TEXT NOT NULL DEFAULT '',
      source_novel_title TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_style_library_user ON style_library(user_id);
    CREATE INDEX IF NOT EXISTS idx_style_library_source ON style_library(user_id, source_novel_id);

    CREATE TABLE IF NOT EXISTS idea_library (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'extracted',
      source_novel_id TEXT NOT NULL DEFAULT '',
      source_novel_title TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_idea_library_user ON idea_library(user_id);
    CREATE INDEX IF NOT EXISTS idx_idea_library_source ON idea_library(user_id, source_novel_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT NOT NULL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Staged analysis results (workspace) until user confirms finish
    CREATE TABLE IF NOT EXISTS analysis_workspace (
      user_id TEXT NOT NULL DEFAULT 'guest',
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT 'main',
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, novel_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS share_overviews (
      token TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_share_overviews_owner_novel
      ON share_overviews(owner_user_id, novel_id);
  `);

  // Migrate old tables that may be missing user_id.
  // Use exec with error suppression — SQLite has no IF NOT EXISTS for ALTER TABLE.
  for (const table of ["novels", "story_info", "characters", "simulations"]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'guest'`); console.log(`[DB] Added user_id to ${table}`); } catch { /* already exists */ }
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
    console.log(`[DB] Added is_admin to users`);
  } catch { /* already exists */ }

  // Promote any existing accounts whose email is in ADMIN_EMAILS
  try {
    promoteAdminEmailsFromEnv(db);
  } catch (e) {
    console.warn("[DB] promoteAdminEmailsFromEnv failed:", e);
  }
}

/** Mark users matching ADMIN_EMAILS as is_admin=1. Safe to call repeatedly. */
function promoteAdminEmailsFromEnv(d: Database.Database): void {
  const emails = Array.from(parseAdminEmails());
  if (emails.length === 0) {
    console.log("[DB] ADMIN_EMAILS not set — no admin auto-promote");
    return;
  }
  console.log(`[DB] ADMIN_EMAILS configured (${emails.length} address(es))`);
  const stmt = d.prepare(
    `UPDATE users SET is_admin = 1, updated_at = datetime('now')
     WHERE lower(email) = ? AND COALESCE(is_admin, 0) = 0`,
  );
  let promoted = 0;
  for (const email of emails) {
    const info = stmt.run(email);
    promoted += Number(info.changes || 0);
  }
  if (promoted > 0) {
    console.log(`[DB] Promoted ${promoted} user(s) to admin via ADMIN_EMAILS`);
  }
  // List admin emails present in DB (help ops confirm match without passwords)
  try {
    const admins = d
      .prepare(
        `SELECT email, is_admin FROM users WHERE is_admin = 1 OR lower(email) IN (${emails
          .map(() => "?")
          .join(",")})`,
      )
      .all(...emails) as { email: string; is_admin: number }[];
    if (admins.length === 0) {
      console.warn(
        "[DB] No users match ADMIN_EMAILS yet — register/login with that email to become admin",
      );
    } else {
      for (const a of admins) {
        console.log(
          `[DB] admin candidate email=${a.email} is_admin=${a.is_admin}`,
        );
      }
    }
  } catch {
    /* ignore list errors */
  }
}

// ---- Auth users / sessions ----

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AuthUserRow extends AuthUser {
  passwordHash: string;
}

function resolveIsAdmin(row: { id: string; email: string; is_admin?: number }): boolean {
  const fromDb = Number(row.is_admin) === 1;
  const fromEnv = isAdminEmail(row.email);
  if (fromEnv && !fromDb) {
    // Persist ADMIN_EMAILS grant so subsequent lookups stay consistent.
    try {
      getDb()
        .prepare(
          `UPDATE users SET is_admin = 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(row.id);
    } catch {
      /* best-effort */
    }
  }
  return fromDb || fromEnv;
}

export function createUser(input: {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  isAdmin?: boolean;
}): AuthUser {
  const d = getDb();
  const isAdmin = input.isAdmin === true || isAdminEmail(input.email);
  d.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, is_admin)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.id, input.email, input.passwordHash, input.displayName, isAdmin ? 1 : 0);
  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    isAdmin,
  };
}

export function getUserByEmail(email: string): AuthUserRow | null {
  const row = getDb()
    .prepare(
      "SELECT id, email, password_hash, display_name, is_admin FROM users WHERE email = ?",
    )
    .get(email) as any;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    passwordHash: row.password_hash,
    isAdmin: resolveIsAdmin(row),
  };
}

export function getUserById(id: string): AuthUser | null {
  const row = getDb()
    .prepare("SELECT id, email, display_name, is_admin FROM users WHERE id = ?")
    .get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    isAdmin: resolveIsAdmin(row),
  };
}

export function createSession(token: string, userId: string, maxAgeSec: number): void {
  const expires = new Date(Date.now() + maxAgeSec * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, userId, expires);
}

export function getSessionUser(token: string): AuthUser | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as any;
  if (!row) {
    // Drop expired/orphan
    d.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    isAdmin: resolveIsAdmin(row),
  };
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function deleteExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// ---- Novel CRUD ----

/**
 * Import a novel: one write to novels + one write to main branch. Same text.
 * This is the only path upload/parse should use — no empty shells, no heal steps.
 */
export function importNovel(
  userId: string,
  novelId: string,
  title: string,
  text: string,
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO novels (id, user_id, title, text, total_length, language, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(novelId, userId, title, text, text.length, "zh");
  // Main working copy starts as full imported text (storage=full). novels.text = import snapshot.
  d.prepare(
    `INSERT OR REPLACE INTO branches
      (id, novel_id, user_id, name, parent_offset, text, parent_branch_id, storage, char_count, updated_at)
     VALUES ('main', ?, ?, '主线', 0, ?, '', 'full', ?, datetime('now'))`,
  ).run(novelId, userId, text, text.length);
}

/**
 * Update novels row. Creates main only when missing/empty — does not wipe
 * continuations already on main. Uploads should use importNovel instead.
 */
export function saveNovel(userId: string, id: string, title: string, text: string): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO novels (id, user_id, title, text, total_length, language, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, userId, title, text, text.length, "zh");
  const main = getBranchByNovelAndId(d, userId, id, "main");
  if (!main) {
    saveBranch(userId, "main", id, "主线", 0, text);
  } else if (!(main.text || "").trim() && text.trim()) {
    d.prepare(
      "UPDATE branches SET text = ?, updated_at = datetime('now') WHERE novel_id = ? AND id = 'main' AND user_id = ?"
    ).run(text, id, userId);
  }
}

export function getNovel(userId: string, id: string): { title: string; text: string } | null {
  const d = getDb();
  return d.prepare("SELECT title, text FROM novels WHERE id = ? AND user_id = ?").get(id, userId) as any || null;
}

/** @deprecated Use appendBranchContent(userId, novelId, "main", content) instead. */
export function appendNovelContent(userId: string, id: string, newContent: string): void {
  const d = getDb();
  const novel = getNovel(userId, id);
  if (!novel) return;
  const combined = novel.text + "\n\n" + newContent;
  saveNovel(userId, id, novel.title, combined);
}

export function listNovels(userId: string): { id: string; title: string; total_length: number; created_at: string }[] {
  const d = getDb();
  return d.prepare("SELECT id, title, total_length, created_at FROM novels WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
}

export function deleteNovel(userId: string, id: string): void {
  const d = getDb();
  const tx = d.transaction(() => {
    // Soft-revoke share links (keep rows for uniform 404; do not hard-delete)
    d.prepare(
      `UPDATE share_overviews SET revoked_at = datetime('now')
       WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL`,
    ).run(userId, id);
    d.prepare("DELETE FROM novels WHERE id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM story_info WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM characters WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM timelines WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM chapter_states WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM timeline_jobs WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM branches WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM novel_form WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM branch_chapter_meta WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM foreshadowing_ledgers WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM drafts WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM simulations WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM scenes WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM generation_logs WHERE novel_id = ? AND user_id = ?").run(id, userId);
    d.prepare("DELETE FROM codex_data WHERE novel_id = ?").run(id);
    // Extracted library entries tied to this book (keep manual entries)
    d.prepare(
      "DELETE FROM style_library WHERE user_id = ? AND source_novel_id = ? AND source = 'extracted'"
    ).run(userId, id);
    d.prepare(
      "DELETE FROM idea_library WHERE user_id = ? AND source_novel_id = ? AND source = 'extracted'"
    ).run(userId, id);
  });
  tx();
}

// ---- Share overviews (public/auth snapshot links) ----

export interface ShareOverviewRow {
  token: string;
  ownerUserId: string;
  novelId: string;
  visibility: ShareVisibility;
  payload: ShareOverviewPayload;
  createdAt: string;
  revokedAt: string | null;
}

export interface ShareOverviewListItem {
  token: string;
  visibility: ShareVisibility;
  createdAt: string;
  revokedAt: string | null;
  url: string;
}

function mapShareRow(row: any): ShareOverviewRow {
  return {
    token: row.token,
    ownerUserId: row.owner_user_id,
    novelId: row.novel_id,
    visibility: row.visibility as ShareVisibility,
    payload: JSON.parse(row.payload) as ShareOverviewPayload,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
  };
}

export function createShareOverview(input: {
  token: string;
  ownerUserId: string;
  novelId: string;
  visibility: ShareVisibility;
  payload: ShareOverviewPayload;
}): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO share_overviews (token, owner_user_id, novel_id, visibility, payload, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)`,
  ).run(
    input.token,
    input.ownerUserId,
    input.novelId,
    input.visibility,
    JSON.stringify(input.payload),
  );
}

export function getShareOverviewByToken(token: string): ShareOverviewRow | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM share_overviews WHERE token = ?`).get(token) as any;
  return row ? mapShareRow(row) : null;
}

export function listShareOverviews(
  ownerUserId: string,
  novelId: string,
  opts?: { includeRevoked?: boolean },
): ShareOverviewListItem[] {
  const d = getDb();
  const includeRevoked = !!opts?.includeRevoked;
  const rows = includeRevoked
    ? (d
        .prepare(
          `SELECT token, visibility, created_at, revoked_at FROM share_overviews
           WHERE owner_user_id = ? AND novel_id = ?
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId, novelId) as any[])
    : (d
        .prepare(
          `SELECT token, visibility, created_at, revoked_at FROM share_overviews
           WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId, novelId) as any[]);
  return rows.map((r) => ({
    token: r.token,
    visibility: r.visibility as ShareVisibility,
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? null,
    url: `/share/${r.token}`,
  }));
}

export function revokeShareOverview(
  token: string,
  ownerUserId: string,
): { ok: true } | { ok: false; reason: "not_found" | "forbidden" } {
  const d = getDb();
  const row = d.prepare(`SELECT owner_user_id, revoked_at FROM share_overviews WHERE token = ?`).get(token) as
    | { owner_user_id: string; revoked_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  if (row.revoked_at) return { ok: true };
  d.prepare(`UPDATE share_overviews SET revoked_at = datetime('now') WHERE token = ?`).run(token);
  return { ok: true };
}

export function updateShareVisibility(
  token: string,
  ownerUserId: string,
  visibility: ShareVisibility,
): { ok: true } | { ok: false; reason: "not_found" | "forbidden" | "revoked" } {
  const d = getDb();
  const row = d.prepare(`SELECT owner_user_id, revoked_at FROM share_overviews WHERE token = ?`).get(token) as
    | { owner_user_id: string; revoked_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  d.prepare(`UPDATE share_overviews SET visibility = ? WHERE token = ?`).run(visibility, token);
  return { ok: true };
}

export function revokeShareOverviewsForNovel(ownerUserId: string, novelId: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE share_overviews SET revoked_at = datetime('now')
     WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL`,
  ).run(ownerUserId, novelId);
}

// ---- Story Info ----

export function saveStoryInfo(userId: string, novelId: string, info: StoryInfo): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO story_info (novel_id, user_id, data) VALUES (?, ?, ?)`
  ).run(novelId, userId, JSON.stringify(info));
}

export function getStoryInfo(userId: string, novelId: string): StoryInfo | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM story_info WHERE novel_id = ? AND user_id = ?").get(novelId, userId) as any;
  return row ? JSON.parse(row.data) : null;
}

// ---- Novel form (bone / chaptering) ----

export function saveNovelForm(
  userId: string,
  novelId: string,
  profile: NovelFormProfile,
): void {
  const d = getDb();
  const data = { ...profile, novelId, updatedAt: new Date().toISOString() };
  d.prepare(
    `INSERT OR REPLACE INTO novel_form (novel_id, user_id, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(novelId, userId, JSON.stringify(data));
}

export function getNovelForm(userId: string, novelId: string): NovelFormProfile | null {
  const d = getDb();
  const row = d
    .prepare("SELECT data FROM novel_form WHERE novel_id = ? AND user_id = ?")
    .get(novelId, userId) as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as NovelFormProfile;
  } catch {
    return null;
  }
}

// ---- Branch chapter meta (boundary + catalog) ----

export function emptyBranchChapterMeta(
  novelId: string,
  branchId: string,
): BranchChapterMeta {
  return {
    novelId,
    branchId,
    chapterBoundary: "closed",
    chapters: [],
    updatedAt: new Date().toISOString(),
  };
}

export function saveBranchChapterMeta(
  userId: string,
  meta: BranchChapterMeta,
): void {
  const d = getDb();
  const data = { ...meta, updatedAt: new Date().toISOString() };
  d.prepare(
    `INSERT OR REPLACE INTO branch_chapter_meta
      (novel_id, branch_id, user_id, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(meta.novelId, meta.branchId, userId, JSON.stringify(data));
}

export function getBranchChapterMeta(
  userId: string,
  novelId: string,
  branchId: string,
): BranchChapterMeta {
  const d = getDb();
  const row = d
    .prepare(
      "SELECT data FROM branch_chapter_meta WHERE novel_id = ? AND branch_id = ? AND user_id = ?",
    )
    .get(novelId, branchId, userId) as { data: string } | undefined;
  if (!row?.data) return emptyBranchChapterMeta(novelId, branchId);
  try {
    const parsed = JSON.parse(row.data) as BranchChapterMeta;
    return {
      ...emptyBranchChapterMeta(novelId, branchId),
      ...parsed,
      novelId,
      branchId,
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
    };
  } catch {
    return emptyBranchChapterMeta(novelId, branchId);
  }
}

/** Copy chapter meta when forking a branch. */
export function copyBranchChapterMeta(
  userId: string,
  novelId: string,
  fromBranchId: string,
  toBranchId: string,
): void {
  const src = getBranchChapterMeta(userId, novelId, fromBranchId);
  saveBranchChapterMeta(userId, {
    ...src,
    branchId: toBranchId,
    chapters: JSON.parse(JSON.stringify(src.chapters || [])) as ChapterCatalogEntry[],
    updatedAt: new Date().toISOString(),
  });
}

// ---- Characters ----

export function saveCharacters(userId: string, novelId: string, characters: CharacterProfile[]): void {
  const d = getDb();
  d.prepare("DELETE FROM characters WHERE novel_id = ? AND user_id = ?").run(novelId, userId);
  const insert = d.prepare(
    "INSERT INTO characters (id, novel_id, user_id, data) VALUES (?, ?, ?, ?)"
  );
  const tx = d.transaction((chars: CharacterProfile[]) => {
    for (const c of chars) {
      insert.run(c.id, novelId, userId, JSON.stringify(c));
    }
  });
  tx(characters);
}

export function getCharacters(userId: string, novelId: string): CharacterProfile[] {
  const d = getDb();
  const rows = d.prepare("SELECT data FROM characters WHERE novel_id = ? AND user_id = ?").all(novelId, userId) as any[];
  return rows.map((r: any) => JSON.parse(r.data));
}

// ---- Simulations ----

export function saveSimulation(userId: string, sim: SimulationState): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO simulations (id, user_id, novel_id, data) VALUES (?, ?, ?, ?)`
  ).run(sim.id, userId, sim.novelTitle, JSON.stringify(sim));
}

export function getSimulation(userId: string, id: string): SimulationState | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM simulations WHERE id = ? AND user_id = ?").get(id, userId) as any;
  return row ? JSON.parse(row.data) : null;
}

export function listSimulations(userId: string, novelId?: string): { id: string; novel_id: string; data: string; created_at: string }[] {
  const d = getDb();
  if (novelId) {
    return d.prepare("SELECT * FROM simulations WHERE novel_id = ? AND user_id = ? ORDER BY created_at DESC").all(novelId, userId) as any[];
  }
  return d.prepare("SELECT * FROM simulations WHERE user_id = ? ORDER BY created_at DESC").all(userId) as any[];
}

// ---- Scenes ----

export function saveScene(userId: string, sceneId: string, novelId: string, scene: unknown): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO scenes (id, user_id, novel_id, data, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(sceneId, userId, novelId, JSON.stringify(scene));
}

export function getScene(userId: string, sceneId: string): unknown | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM scenes WHERE id = ? AND user_id = ?").get(sceneId, userId) as any;
  return row ? JSON.parse(row.data) : null;
}

export function listScenes(userId: string, novelId?: string): { id: string; novel_id: string; data: string; created_at: string }[] {
  const d = getDb();
  if (novelId) {
    return d.prepare("SELECT id, novel_id, data, created_at FROM scenes WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC").all(novelId, userId) as any[];
  }
  return d.prepare("SELECT id, novel_id, data, created_at FROM scenes WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
}

// ---- Chat History ----

export function saveChatHistory(userId: string, characterId: string, messages: unknown): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO chat_history (user_id, character_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))`
  ).run(userId, characterId, JSON.stringify(messages));
}

export function getChatHistory(userId: string, characterId: string): unknown | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM chat_history WHERE user_id = ? AND character_id = ?").get(userId, characterId) as any;
  return row ? JSON.parse(row.data) : null;
}

// ---- Generation Logs ----

export interface GenLogEntry {
  id: string;
  userId: string;
  novelId?: string;
  category: string;
  label: string;
  inputSummary?: string;
  outputPreview?: string;
  fullOutput?: string;
  tokenEstimate?: number;
  createdAt: string;
}

export function saveGenerationLog(entry: {
  id: string;
  userId: string;
  novelId?: string;
  category: string;
  label: string;
  inputSummary?: string;
  outputPreview?: string;
  fullOutput?: string;
  tokenEstimate?: number;
}): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO generation_logs (id, user_id, novel_id, category, label, input_summary, output_preview, full_output, token_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(entry.id, entry.userId, entry.novelId || null, entry.category, entry.label, entry.inputSummary || null, entry.outputPreview || null, entry.fullOutput || null, entry.tokenEstimate || null);
}

export function listGenerationLogs(userId: string, limit = 50, category?: string): GenLogEntry[] {
  const d = getDb();
  if (category) {
    const rows = d.prepare("SELECT * FROM generation_logs WHERE user_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?").all(userId, category, limit) as any[];
    return rows.map(rowToGenLog);
  }
  const rows = d.prepare("SELECT * FROM generation_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as any[];
  return rows.map(rowToGenLog);
}

export function getGenerationLog(userId: string, id: string): GenLogEntry | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM generation_logs WHERE id = ? AND user_id = ?").get(id, userId) as any;
  return row ? rowToGenLog(row) : null;
}

function rowToGenLog(row: any): GenLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    novelId: row.novel_id,
    category: row.category,
    label: row.label,
    inputSummary: row.input_summary,
    outputPreview: row.output_preview,
    fullOutput: row.full_output,
    tokenEstimate: row.token_estimate,
    createdAt: row.created_at,
  };
}

// ---- Token usage (admin analytics) ----

export interface TokenUsageEntry {
  id: string;
  userId: string;
  novelId: string;
  branchId: string;
  agentId: string;
  category: string;
  model: string;
  operation: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  createdAt: string;
}

export function saveTokenUsage(entry: {
  id: string;
  userId?: string;
  novelId?: string;
  branchId?: string;
  agentId?: string;
  category?: string;
  model?: string;
  operation?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}): void {
  const prompt = entry.promptTokens || 0;
  const completion = entry.completionTokens || 0;
  const total = entry.totalTokens || prompt + completion;
  getDb()
    .prepare(
      `INSERT INTO token_usage
        (id, user_id, novel_id, branch_id, agent_id, category, model, operation,
         prompt_tokens, completion_tokens, total_tokens, estimated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      entry.id,
      entry.userId || "",
      entry.novelId || "",
      entry.branchId || "",
      entry.agentId || "",
      entry.category || "",
      entry.model || "",
      entry.operation || "",
      prompt,
      completion,
      total,
      entry.estimated ? 1 : 0,
    );
}

export interface TokenUsageFilters {
  userId?: string;
  novelId?: string;
  branchId?: string;
  agentId?: string;
  since?: string; // ISO or sqlite datetime
  until?: string;
  limit?: number;
}

export function listTokenUsage(filters: TokenUsageFilters = {}): TokenUsageEntry[] {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.userId) {
    clauses.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters.novelId) {
    clauses.push("novel_id = ?");
    params.push(filters.novelId);
  }
  if (filters.branchId) {
    clauses.push("branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.agentId) {
    clauses.push("agent_id = ?");
    params.push(filters.agentId);
  }
  if (filters.since) {
    clauses.push("created_at >= ?");
    params.push(filters.since);
  }
  if (filters.until) {
    clauses.push("created_at <= ?");
    params.push(filters.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit || 200, 1), 2000);
  params.push(limit);
  const rows = getDb()
    .prepare(
      `SELECT * FROM token_usage ${where} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params) as any[];
  return rows.map(rowToTokenUsage);
}

export interface TokenUsageAggregate {
  key: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCalls: number;
}

export function aggregateTokenUsage(
  groupBy: "agent_id" | "user_id" | "novel_id" | "branch_id" | "model" | "day",
  filters: TokenUsageFilters = {},
): TokenUsageAggregate[] {
  const col =
    groupBy === "day"
      ? "substr(created_at, 1, 10)"
      : groupBy;
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.userId) {
    clauses.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters.novelId) {
    clauses.push("novel_id = ?");
    params.push(filters.novelId);
  }
  if (filters.branchId) {
    clauses.push("branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.agentId) {
    clauses.push("agent_id = ?");
    params.push(filters.agentId);
  }
  if (filters.since) {
    clauses.push("created_at >= ?");
    params.push(filters.since);
  }
  if (filters.until) {
    clauses.push("created_at <= ?");
    params.push(filters.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT ${col} AS key,
              COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(estimated), 0) AS estimated_calls
       FROM token_usage
       ${where}
       GROUP BY ${col}
       ORDER BY total_tokens DESC`
    )
    .all(...params) as any[];
  return rows.map((r) => ({
    key: r.key == null || r.key === "" ? "(empty)" : String(r.key),
    calls: r.calls || 0,
    promptTokens: r.prompt_tokens || 0,
    completionTokens: r.completion_tokens || 0,
    totalTokens: r.total_tokens || 0,
    estimatedCalls: r.estimated_calls || 0,
  }));
}

export function tokenUsageSummary(filters: TokenUsageFilters = {}): {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCalls: number;
} {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.userId) {
    clauses.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters.novelId) {
    clauses.push("novel_id = ?");
    params.push(filters.novelId);
  }
  if (filters.branchId) {
    clauses.push("branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.agentId) {
    clauses.push("agent_id = ?");
    params.push(filters.agentId);
  }
  if (filters.since) {
    clauses.push("created_at >= ?");
    params.push(filters.since);
  }
  if (filters.until) {
    clauses.push("created_at <= ?");
    params.push(filters.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(estimated), 0) AS estimated_calls
       FROM token_usage ${where}`
    )
    .get(...params) as any;
  return {
    calls: row?.calls || 0,
    promptTokens: row?.prompt_tokens || 0,
    completionTokens: row?.completion_tokens || 0,
    totalTokens: row?.total_tokens || 0,
    estimatedCalls: row?.estimated_calls || 0,
  };
}

function rowToTokenUsage(row: any): TokenUsageEntry {
  return {
    id: row.id,
    userId: row.user_id || "",
    novelId: row.novel_id || "",
    branchId: row.branch_id || "",
    agentId: row.agent_id || "",
    category: row.category || "",
    model: row.model || "",
    operation: row.operation || "",
    promptTokens: row.prompt_tokens || 0,
    completionTokens: row.completion_tokens || 0,
    totalTokens: row.total_tokens || 0,
    estimated: !!row.estimated,
    createdAt: row.created_at,
  };
}

// ---- Timeline (branch-scoped) ----

export function saveTimeline(
  userId: string,
  novelId: string,
  timeline: ChapterTimeline,
  branchId = "main",
): void {
  const d = getDb();
  const data = { ...timeline, novelId, branchId };
  d.prepare(
    `INSERT OR REPLACE INTO timelines (novel_id, user_id, branch_id, data) VALUES (?, ?, ?, ?)`,
  ).run(novelId, userId, branchId, JSON.stringify(data));
}

export function getTimeline(
  userId: string,
  novelId: string,
  branchId = "main",
): ChapterTimeline | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT data FROM timelines WHERE novel_id = ? AND user_id = ? AND branch_id = ?`,
    )
    .get(novelId, userId, branchId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChapterTimeline) : null;
}

// ---- Chapter States (branch-scoped) ----

export function saveChapterStates(
  userId: string,
  novelId: string,
  states: CharacterChapterState[],
  branchId = "main",
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO chapter_states (novel_id, user_id, branch_id, data) VALUES (?, ?, ?, ?)`,
  ).run(novelId, userId, branchId, JSON.stringify(states));
}

export function getChapterStates(
  userId: string,
  novelId: string,
  branchId = "main",
): CharacterChapterState[] {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT data FROM chapter_states WHERE novel_id = ? AND user_id = ? AND branch_id = ?`,
    )
    .get(novelId, userId, branchId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as CharacterChapterState[]) : [];
}

// ---- Timeline jobs (durable status for rail poll; JSON blob matches TimelineJob) ----

/** Minimal fields required to persist a timeline job (full object stored as JSON). */
export type TimelineJobPersist = {
  id: string;
  userId: string;
  novelId: string;
  branchId: string;
  status: string;
  updatedAt?: string;
  createdAt?: string;
};

export function saveTimelineJobRow(job: TimelineJobPersist): void {
  ensureTimelineJobsTable(getDb());
  const d = getDb();
  const updatedAt = String(job.updatedAt || new Date().toISOString());
  const existing = d
    .prepare(`SELECT created_at FROM timeline_jobs WHERE id = ?`)
    .get(job.id) as { created_at?: string } | undefined;
  const createdAt = String(
    existing?.created_at || job.createdAt || updatedAt,
  );
  d.prepare(
    `INSERT OR REPLACE INTO timeline_jobs
      (id, user_id, novel_id, branch_id, status, data, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.userId,
    job.novelId,
    job.branchId,
    job.status,
    JSON.stringify(job),
    updatedAt,
    createdAt,
  );
}

export function getTimelineJobRow(id: string): TimelineJobPersist | null {
  ensureTimelineJobsTable(getDb());
  const d = getDb();
  const row = d
    .prepare(`SELECT data FROM timeline_jobs WHERE id = ?`)
    .get(id) as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as TimelineJobPersist;
  } catch {
    return null;
  }
}

// ---- Character extract jobs + per-unit name cache ----

function ensureCharacterExtractTables(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS character_extract_jobs (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    );
    CREATE INDEX IF NOT EXISTS idx_char_extract_jobs_novel
      ON character_extract_jobs (user_id, novel_id, updated_at);

    CREATE TABLE IF NOT EXISTS character_name_unit_cache (
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, novel_id, cache_key)
    );
  `);
}

export function saveCharacterExtractJobRow(job: {
  id: string;
  userId: string;
  novelId: string;
  branchId?: string;
  status: string;
  updatedAt?: string;
  createdAt?: string;
}): void {
  const d = getDb();
  ensureCharacterExtractTables(d);
  const updatedAt = String(job.updatedAt || new Date().toISOString());
  const existing = d
    .prepare(`SELECT created_at FROM character_extract_jobs WHERE id = ?`)
    .get(job.id) as { created_at?: string } | undefined;
  const createdAt = String(
    existing?.created_at || job.createdAt || updatedAt,
  );
  d.prepare(
    `INSERT OR REPLACE INTO character_extract_jobs
      (id, user_id, novel_id, branch_id, status, data, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.userId,
    job.novelId,
    job.branchId || "main",
    job.status,
    JSON.stringify(job),
    updatedAt,
    createdAt,
  );
}

export function getCharacterExtractJobRow(id: string): Record<string, unknown> | null {
  const d = getDb();
  ensureCharacterExtractTables(d);
  const row = d
    .prepare(`SELECT data FROM character_extract_jobs WHERE id = ?`)
    .get(id) as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listCharacterExtractJobRows(
  userId: string,
  novelId: string,
): Record<string, unknown>[] {
  const d = getDb();
  ensureCharacterExtractTables(d);
  const rows = d
    .prepare(
      `SELECT data FROM character_extract_jobs
       WHERE user_id = ? AND novel_id = ?
       ORDER BY updated_at DESC LIMIT 20`,
    )
    .all(userId, novelId) as { data: string }[];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

export function getNameUnitCache(
  userId: string,
  novelId: string,
  cacheKey: string,
): { name: string; aliases?: string[]; count?: number }[] | null {
  const d = getDb();
  ensureCharacterExtractTables(d);
  const row = d
    .prepare(
      `SELECT data FROM character_name_unit_cache
       WHERE user_id = ? AND novel_id = ? AND cache_key = ?`,
    )
    .get(userId, novelId, cacheKey) as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export function saveNameUnitCache(
  userId: string,
  novelId: string,
  cacheKey: string,
  hits: { name: string; aliases?: string[]; count?: number }[],
): void {
  const d = getDb();
  ensureCharacterExtractTables(d);
  d.prepare(
    `INSERT OR REPLACE INTO character_name_unit_cache
      (user_id, novel_id, cache_key, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(userId, novelId, cacheKey, JSON.stringify(hits));
}

export function listTimelineJobRows(
  userId: string,
  novelId: string,
  branchId = "main",
): TimelineJobPersist[] {
  ensureTimelineJobsTable(getDb());
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT data FROM timeline_jobs
       WHERE user_id = ? AND novel_id = ? AND branch_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(userId, novelId, branchId) as { data: string }[];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data) as TimelineJobPersist;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as TimelineJobPersist[];
}

function ensureTimelineJobsTable(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS timeline_jobs (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    );
  `);
  const cols = d.prepare("PRAGMA table_info(timeline_jobs)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("created_at") || !names.has("updated_at")) {
    // Rebuild if an older draft schema lacked columns
    try {
      d.exec(`
        CREATE TABLE timeline_jobs_v2 (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          novel_id TEXT NOT NULL,
          branch_id TEXT NOT NULL DEFAULT 'main',
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (id)
        );
        INSERT OR IGNORE INTO timeline_jobs_v2
          (id, user_id, novel_id, branch_id, status, data, updated_at, created_at)
        SELECT
          id, user_id, novel_id, branch_id, status, data,
          COALESCE(updated_at, datetime('now')),
          datetime('now')
        FROM timeline_jobs;
        DROP TABLE timeline_jobs;
        ALTER TABLE timeline_jobs_v2 RENAME TO timeline_jobs;
      `);
      console.log("[DB] Rebuilt timeline_jobs with created_at/updated_at");
    } catch (e) {
      console.warn("[DB] timeline_jobs rebuild failed:", (e as Error).message);
    }
  }
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_timeline_jobs_novel
      ON timeline_jobs (user_id, novel_id, branch_id, updated_at);
  `);
}

export function deleteTimelineJobRowsForNovel(userId: string, novelId: string): void {
  const d = getDb();
  d.prepare(`DELETE FROM timeline_jobs WHERE user_id = ? AND novel_id = ?`).run(userId, novelId);
}

// ---- Agent Prompts ----

export interface AgentPromptRow {
  agent_id: string;
  language: string;
  name: string;
  description: string;
  category: string;
  system_prompt: string | null;
  user_prompt_template: string | null;
  is_modified: number;
  updated_at: string;
}

export function seedAgentPrompts(
  agents: { agentId: string; name: string; description: string; category: string }[],
  language: string = "zh",
): void {
  const d = getDb();
  const upsert = d.prepare(
    `INSERT INTO agent_prompts (agent_id, language, name, description, category)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id, language) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category`
  );
  const tx = d.transaction(() => {
    for (const agent of agents) {
      upsert.run(agent.agentId, language, agent.name, agent.description, agent.category);
    }
  });
  tx();
}

export function listAgentPrompts(): AgentPromptRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM agent_prompts WHERE language = 'zh' ORDER BY category, agent_id").all() as AgentPromptRow[];
}

export function getAgentPrompt(agentId: string, language: string): AgentPromptRow | null {
  const d = getDb();
  return (d.prepare("SELECT * FROM agent_prompts WHERE agent_id = ? AND language = ?").get(agentId, language) as AgentPromptRow) || null;
}

export function updateAgentPrompt(
  agentId: string,
  language: string,
  fields: { system_prompt?: string | null; user_prompt_template?: string | null }
): void {
  const d = getDb();
  const sets: string[] = ["is_modified = 1", "updated_at = datetime('now')"];
  const params: (string | null)[] = [];
  if (fields.system_prompt !== undefined) {
    sets.push("system_prompt = ?");
    params.push(fields.system_prompt);
  }
  if (fields.user_prompt_template !== undefined) {
    sets.push("user_prompt_template = ?");
    params.push(fields.user_prompt_template);
  }
  params.push(agentId, language);
  d.prepare(`UPDATE agent_prompts SET ${sets.join(", ")} WHERE agent_id = ? AND language = ?`).run(...params);
}

export function resetAgentPrompt(agentId: string, language: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE agent_prompts SET system_prompt = NULL, user_prompt_template = NULL, is_modified = 0, updated_at = datetime('now')
     WHERE agent_id = ? AND language = ?`
  ).run(agentId, language);
}

/** Remove agent_prompts rows whose agent_id is not in the allowlist. */
export function pruneAgentPrompts(allowedAgentIds: string[]): void {
  const d = getDb();
  const allowed = new Set(allowedAgentIds);
  const rows = d.prepare("SELECT DISTINCT agent_id FROM agent_prompts").all() as { agent_id: string }[];
  for (const r of rows) {
    if (!allowed.has(r.agent_id)) {
      d.prepare("DELETE FROM agent_prompts WHERE agent_id = ?").run(r.agent_id);
    }
  }
}

// ---- Codex Data ----

import type { WritersCodex } from "@/core/codex/types";

export function saveCodex(novelId: string, codex: WritersCodex): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO codex_data (novel_id, data, updated_at) VALUES (?, ?, datetime('now'))`
  ).run(novelId, JSON.stringify(codex));
}

export function getCodex(novelId: string): WritersCodex | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM codex_data WHERE novel_id = ?").get(novelId) as any;
  return row ? JSON.parse(row.data) : null;
}

export function deleteCodex(novelId: string): void {
  const d = getDb();
  d.prepare("DELETE FROM codex_data WHERE novel_id = ?").run(novelId);
}

// ---- Branches ----

/** storage=full: text is full body. storage=cow: text is suffix after parent[0:parent_offset]. */
export type BranchStorage = "full" | "cow";

export interface BranchRow {
  id: string;
  novel_id: string;
  name: string;
  parent_offset: number;
  text: string;
  parent_branch_id: string;
  storage: BranchStorage;
  /** Logical full-body length (resolved). */
  char_count: number;
  created_at: string;
  updated_at: string;
}

/** Branch list row without full text (safe for long novels / many forks). */
export interface BranchMetaRow {
  id: string;
  novel_id: string;
  name: string;
  parent_offset: number;
  char_count: number;
  parent_branch_id: string;
  storage: BranchStorage;
  created_at: string;
  updated_at: string;
}

function normalizeBranchRow(row: any): BranchRow | null {
  if (!row) return null;
  return {
    id: row.id,
    novel_id: row.novel_id,
    name: row.name || "",
    parent_offset: Number(row.parent_offset) || 0,
    text: row.text || "",
    parent_branch_id: row.parent_branch_id || "",
    storage: row.storage === "cow" ? "cow" : "full",
    char_count: Number(row.char_count) || 0,
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

export function saveBranch(
  userId: string,
  branchId: string,
  novelId: string,
  name: string,
  parentOffset: number,
  text: string,
  opts?: {
    parentBranchId?: string;
    storage?: BranchStorage;
    charCount?: number;
  },
): void {
  const d = getDb();
  const storage: BranchStorage = opts?.storage || "full";
  const parentBranchId = opts?.parentBranchId || "";
  const charCount =
    typeof opts?.charCount === "number" ? opts.charCount : (text || "").length;
  d.prepare(
    `INSERT OR REPLACE INTO branches
      (id, novel_id, user_id, name, parent_offset, text, parent_branch_id, storage, char_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    branchId,
    novelId,
    userId,
    name,
    parentOffset,
    text || "",
    parentBranchId,
    storage,
    charCount,
  );
}

/**
 * Create an IF branch with CoW storage: only suffix after parent_offset is stored.
 * Logical full text = resolve(parent)[0:offset] + suffix (initially empty).
 */
export function createCowBranch(
  userId: string,
  novelId: string,
  branchId: string,
  name: string,
  parentBranchId: string,
  parentOffset: number,
): BranchRow {
  ensureMainBranch(userId, novelId);
  const parentId = parentBranchId || "main";
  const { text: parentFull } = getBranchProse(userId, novelId, parentId);
  const offset = Math.max(0, Math.min(parentOffset, parentFull.length));
  saveBranch(userId, branchId, novelId, name, offset, "", {
    parentBranchId: parentId,
    storage: "cow",
    charCount: offset,
  });
  const row = getBranch(userId, novelId, branchId);
  if (!row) throw new Error("createCowBranch failed");
  return row;
}

/**
 * Resolve logical full prose for a branch (CoW chain).
 * Depth-capped to avoid cycles.
 */
export function resolveBranchText(
  userId: string,
  novelId: string,
  branchId: string,
  depth = 0,
  seen?: Set<string>,
): string {
  if (depth > 32) return "";
  const visited = seen || new Set<string>();
  if (visited.has(branchId)) return "";
  visited.add(branchId);

  if (branchId === "main") ensureMainBranch(userId, novelId);
  const row = getBranch(userId, novelId, branchId);
  if (!row) return "";

  if (row.storage === "cow" && row.parent_branch_id) {
    const parentFull = resolveBranchText(
      userId,
      novelId,
      row.parent_branch_id,
      depth + 1,
      visited,
    );
    const off = Math.max(0, Math.min(row.parent_offset, parentFull.length));
    return parentFull.slice(0, off) + (row.text || "");
  }
  return row.text || "";
}

// ---- Foreshadowing ledger (per branch) ----

export function getForeshadowingLedger(
  userId: string,
  novelId: string,
  branchId: string,
): ForeshadowingLedger {
  const row = getDb()
    .prepare(
      "SELECT data FROM foreshadowing_ledgers WHERE user_id = ? AND novel_id = ? AND branch_id = ?",
    )
    .get(userId, novelId, branchId) as { data: string } | undefined;
  if (!row?.data) return emptyLedger(userId, novelId, branchId);
  try {
    const parsed = JSON.parse(row.data) as ForeshadowingLedger;
    return {
      ...emptyLedger(userId, novelId, branchId),
      ...parsed,
      userId,
      novelId,
      branchId,
      active: Array.isArray(parsed.active) ? parsed.active : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptyLedger(userId, novelId, branchId);
  }
}

export function saveForeshadowingLedger(ledger: ForeshadowingLedger): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO foreshadowing_ledgers
        (user_id, novel_id, branch_id, version, data, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      ledger.userId,
      ledger.novelId,
      ledger.branchId,
      ledger.version || 1,
      JSON.stringify(ledger),
    );
}

/** Copy ledger when forking a branch (snapshot). */
export function copyForeshadowingLedger(
  userId: string,
  novelId: string,
  fromBranchId: string,
  toBranchId: string,
): void {
  const src = getForeshadowingLedger(userId, novelId, fromBranchId);
  const copy: ForeshadowingLedger = {
    ...src,
    branchId: toBranchId,
    version: 1,
    updatedAt: new Date().toISOString(),
    active: JSON.parse(JSON.stringify(src.active || [])),
    history: JSON.parse(JSON.stringify(src.history || [])),
  };
  saveForeshadowingLedger(copy);
}

/**
 * Append continuation prose onto a branch.
 * - full storage: read stored text, concat, write (working copy only — no novels dual-write)
 * - cow storage: only rewrite suffix (+ update char_count); parent body untouched
 * @param fromOffset absolute offset in *resolved* full body; keep [0, fromOffset) then append
 */
export function appendBranchContent(
  userId: string,
  novelId: string,
  branchId: string,
  newContent: string,
  fromOffset?: number,
): void {
  const d = getDb();
  const row = getBranch(userId, novelId, branchId);
  if (!row) return;
  const incoming = (newContent || "").trim();
  if (!incoming) return;

  const resolved = resolveBranchText(userId, novelId, branchId);
  let baseFull = resolved;
  if (typeof fromOffset === "number" && fromOffset >= 0 && fromOffset < baseFull.length) {
    baseFull = baseFull.slice(0, fromOffset);
  }

  if (baseFull.endsWith(incoming) || baseFull.includes("\n\n" + incoming)) {
    return;
  }

  const combined = baseFull
    ? baseFull.replace(/\s*$/, "") + "\n\n" + incoming
    : incoming;

  if (row.storage === "cow" && row.parent_branch_id) {
    const parentFull = resolveBranchText(userId, novelId, row.parent_branch_id);
    const off = Math.max(0, Math.min(row.parent_offset, parentFull.length));
    const parentPrefix = parentFull.slice(0, off);
    // Keep CoW if combined still starts with the frozen parent prefix
    if (combined.startsWith(parentPrefix)) {
      const suffix = combined.slice(off);
      d.prepare(
        `UPDATE branches SET text = ?, char_count = ?, updated_at = datetime('now')
         WHERE novel_id = ? AND id = ? AND user_id = ?`,
      ).run(suffix, combined.length, novelId, branchId, userId);
    } else {
      // Truncation crossed parent boundary — materialize full body
      d.prepare(
        `UPDATE branches SET text = ?, storage = 'full', parent_branch_id = '',
            parent_offset = 0, char_count = ?, updated_at = datetime('now')
         WHERE novel_id = ? AND id = ? AND user_id = ?`,
      ).run(combined, combined.length, novelId, branchId, userId);
    }
  } else {
    d.prepare(
      `UPDATE branches SET text = ?, char_count = ?, updated_at = datetime('now')
       WHERE novel_id = ? AND id = ? AND user_id = ?`,
    ).run(combined, combined.length, novelId, branchId, userId);
  }

  // novels.text stays import snapshot; only refresh total_length for library UI
  if (branchId === "main") {
    d.prepare(
      `UPDATE novels SET total_length = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(combined.length, novelId, userId);
  }
}

export function getBranch(
  userId: string,
  novelId: string,
  branchId: string,
): BranchRow | null {
  const d = getDb();
  return getBranchByNovelAndId(d, userId, novelId, branchId);
}

export function getBranchByNovelAndId(
  d: Database.Database,
  userId: string,
  novelId: string,
  branchId: string,
): BranchRow | null {
  const row = d.prepare(
    `SELECT id, novel_id, name, parent_offset, text,
            COALESCE(parent_branch_id, '') AS parent_branch_id,
            COALESCE(storage, 'full') AS storage,
            COALESCE(char_count, 0) AS char_count,
            created_at, updated_at
     FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?`,
  ).get(novelId, branchId, userId);
  return normalizeBranchRow(row);
}

/**
 * List branches with metadata only (no `text`).
 * char_count is logical full length (maintained on write).
 */
export function listBranches(
  userId: string,
  novelId: string,
): BranchMetaRow[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT id, novel_id, name, parent_offset,
            COALESCE(char_count, length(COALESCE(text, ''))) AS char_count,
            COALESCE(parent_branch_id, '') AS parent_branch_id,
            COALESCE(storage, 'full') AS storage,
            created_at, updated_at
     FROM branches
     WHERE novel_id = ? AND user_id = ?
     ORDER BY updated_at DESC`,
  ).all(novelId, userId) as BranchMetaRow[];
  return rows.map((r) => ({
    ...r,
    storage: r.storage === "cow" ? "cow" : "full",
    char_count: Number(r.char_count) || 0,
  }));
}

/** @deprecated Prefer listBranches (meta). Full-text list is expensive for long novels. */
export function listBranchesWithText(
  userId: string,
  novelId: string,
): BranchRow[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT id, novel_id, name, parent_offset, text,
            COALESCE(parent_branch_id, '') AS parent_branch_id,
            COALESCE(storage, 'full') AS storage,
            COALESCE(char_count, 0) AS char_count,
            created_at, updated_at
     FROM branches WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC`,
  ).all(novelId, userId);
  return rows.map((r) => normalizeBranchRow(r)!).filter(Boolean);
}

/**
 * Delete an IF branch (and its foreshadowing ledger).
 * Refuses to delete id "main" — main line is the novel source of truth.
 */
export function deleteBranch(
  userId: string,
  novelId: string,
  branchId: string,
): { ok: true } | { ok: false; error: string } {
  if (!branchId || branchId === "main") {
    return { ok: false, error: "不能删除主线" };
  }
  const existing = getBranch(userId, novelId, branchId);
  if (!existing) {
    return { ok: false, error: "分支不存在" };
  }
  const d = getDb();
  const tx = d.transaction(() => {
    d.prepare(
      "DELETE FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?",
    ).run(novelId, branchId, userId);
    d.prepare(
      "DELETE FROM foreshadowing_ledgers WHERE novel_id = ? AND branch_id = ? AND user_id = ?",
    ).run(novelId, branchId, userId);
  });
  tx();
  return { ok: true };
}

/** Lazy: if novel exists but main missing, create main from novel text. No empty shells. */
export function ensureMainBranch(userId: string, novelId: string): void {
  if (getBranch(userId, novelId, "main")) return;
  const novel = getNovel(userId, novelId);
  if (!novel?.text?.trim()) return;
  saveBranch(userId, "main", novelId, "主线", 0, novel.text, {
    storage: "full",
    charCount: novel.text.length,
  });
}

/** Branch working text for agents/UI (always resolved full body). */
export function getBranchProse(
  userId: string,
  novelId: string,
  branchId: string,
): { text: string; source: "branch" | "novel" | "empty"; branch: BranchRow | null } {
  if (branchId === "main") ensureMainBranch(userId, novelId);
  const branch = getBranch(userId, novelId, branchId);
  if (!branch) return { text: "", source: "empty", branch: null };
  const text = resolveBranchText(userId, novelId, branchId);
  if (text.trim()) return { text, source: "branch", branch };
  // Empty CoW fork at offset 0 is valid empty branch
  if (branch.storage === "cow") return { text: text || "", source: "branch", branch };
  return { text: "", source: "empty", branch };
}

// ---- Drafts ----

export interface DraftRow {
  id: string;
  novel_id: string;
  title: string;
  content: string;
  parent_offset: number;
  created_at: string;
  updated_at: string;
}

export function saveDraft(userId: string, id: string, novelId: string, title: string, content: string, parentOffset: number): void {
  const d = getDb();
  d.prepare(`INSERT OR REPLACE INTO drafts (id, novel_id, user_id, title, content, parent_offset, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(id, novelId, userId, title, content, parentOffset);
}

export function getDraft(userId: string, id: string): DraftRow | null {
  const d = getDb();
  return d.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").get(id, userId) as DraftRow | null;
}

export function listDrafts(userId: string, novelId: string): DraftRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM drafts WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC").all(novelId, userId) as DraftRow[];
}

export function deleteDraft(userId: string, id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM drafts WHERE id = ? AND user_id = ?").run(id, userId);
}

// ---- Style library (user-global, cross-novel) ----

const EMPTY_STYLE: WritingStyle = {
  genre: "",
  styleDescription: "",
  narrativeTechniques: [],
  languageFeatures: "",
  pacingDescription: "",
  tone: "",
  examplePassages: [],
  contentRating: { level: "", description: "", hasExplicitContent: false },
};

function rowToStyle(row: any): StyleLibraryEntry {
  let style: WritingStyle = { ...EMPTY_STYLE };
  try {
    style = { ...EMPTY_STYLE, ...JSON.parse(row.data || "{}") };
  } catch { /* keep empty */ }
  const source = row.source === "manual" ? "manual" : "extracted";
  const sourceNovelTitle = row.source_novel_title || "";
  // Extracted styles are labeled by novel title so books stay distinguishable
  const name =
    source === "extracted" && sourceNovelTitle.trim()
      ? sourceNovelTitle.trim()
      : (row.name || "");
  return {
    id: row.id,
    name,
    description: row.description || "",
    style,
    source,
    sourceNovelId: row.source_novel_id || "",
    sourceNovelTitle,
    createdAt: row.created_at,
  };
}

export function listStyles(
  userId: string,
  opts?: { sourceNovelId?: string },
): StyleLibraryEntry[] {
  const d = getDb();
  if (opts?.sourceNovelId) {
    return (d.prepare(
      "SELECT * FROM style_library WHERE user_id = ? AND source_novel_id = ? ORDER BY created_at ASC"
    ).all(userId, opts.sourceNovelId) as any[]).map(rowToStyle);
  }
  return (d.prepare(
    "SELECT * FROM style_library WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[]).map(rowToStyle);
}

export function getStyle(userId: string, id: string): StyleLibraryEntry | null {
  const row = getDb().prepare(
    "SELECT * FROM style_library WHERE id = ? AND user_id = ?"
  ).get(id, userId) as any;
  return row ? rowToStyle(row) : null;
}

export function saveStyle(userId: string, entry: StyleLibraryEntry): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO style_library
      (id, user_id, name, description, data, source, source_novel_id, source_novel_title, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    entry.id,
    userId,
    entry.name,
    entry.description || "",
    JSON.stringify(entry.style || EMPTY_STYLE),
    entry.source || "manual",
    entry.sourceNovelId || "",
    entry.sourceNovelTitle || "",
  );
}

export function deleteStyle(userId: string, id: string): void {
  getDb().prepare("DELETE FROM style_library WHERE id = ? AND user_id = ?").run(id, userId);
}

export function upsertExtractedStyle(
  userId: string,
  novelId: string,
  novelTitle: string,
  writingStyle: WritingStyle | null | undefined,
): StyleLibraryEntry | null {
  if (!writingStyle?.styleDescription && !writingStyle?.genre) return null;
  const id = `style_${novelId}_canon`;
  // Prefer explicit title; if caller passed novelId by mistake, re-read novels row
  let title = (novelTitle || "").trim();
  if (!title || title === novelId) {
    const n = getNovel(userId, novelId);
    const nt = (n?.title || "").trim();
    if (nt && nt !== novelId) title = nt;
  }
  if (!title) title = novelId;
  const entry: StyleLibraryEntry = {
    id,
    // Display name = novel title so styles are distinguishable across books
    name: title,
    description: writingStyle.styleDescription || writingStyle.tone || writingStyle.genre || "",
    style: { ...EMPTY_STYLE, ...writingStyle },
    source: "extracted",
    sourceNovelId: novelId,
    sourceNovelTitle: title,
  };
  saveStyle(userId, entry);
  return entry;
}

// ---- Idea library (user-global, cross-novel) ----

function rowToIdea(row: any): IdeaLibraryEntry {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch { tags = []; }
  return {
    id: row.id,
    title: row.title || "",
    content: row.content || "",
    tags: Array.isArray(tags) ? tags : [],
    source: row.source === "manual" ? "manual" : "extracted",
    sourceNovelId: row.source_novel_id || "",
    sourceNovelTitle: row.source_novel_title || "",
    createdAt: row.created_at,
  };
}

export function listIdeas(
  userId: string,
  opts?: { sourceNovelId?: string },
): IdeaLibraryEntry[] {
  const d = getDb();
  if (opts?.sourceNovelId) {
    return (d.prepare(
      "SELECT * FROM idea_library WHERE user_id = ? AND source_novel_id = ? ORDER BY created_at ASC"
    ).all(userId, opts.sourceNovelId) as any[]).map(rowToIdea);
  }
  return (d.prepare(
    "SELECT * FROM idea_library WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as any[]).map(rowToIdea);
}

export function getIdea(userId: string, id: string): IdeaLibraryEntry | null {
  const row = getDb().prepare(
    "SELECT * FROM idea_library WHERE id = ? AND user_id = ?"
  ).get(id, userId) as any;
  return row ? rowToIdea(row) : null;
}

export function saveIdea(userId: string, entry: IdeaLibraryEntry): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO idea_library
      (id, user_id, title, content, tags, source, source_novel_id, source_novel_title, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    entry.id,
    userId,
    entry.title,
    entry.content,
    JSON.stringify(entry.tags || []),
    entry.source || "manual",
    entry.sourceNovelId || "",
    entry.sourceNovelTitle || "",
  );
}

export function saveIdeasBatch(userId: string, entries: IdeaLibraryEntry[]): void {
  const d = getDb();
  const insert = d.prepare(
    `INSERT OR REPLACE INTO idea_library
      (id, user_id, title, content, tags, source, source_novel_id, source_novel_title, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );
  const tx = d.transaction((list: IdeaLibraryEntry[]) => {
    for (const e of list) {
      insert.run(
        e.id, userId, e.title, e.content,
        JSON.stringify(e.tags || []), e.source || "extracted",
        e.sourceNovelId || "", e.sourceNovelTitle || "",
      );
    }
  });
  tx(entries);
}

export function deleteIdea(userId: string, id: string): void {
  getDb().prepare("DELETE FROM idea_library WHERE id = ? AND user_id = ?").run(id, userId);
}

/** Remove extracted ideas for a novel (keep manual); then insert new batch. */
export function replaceExtractedIdeas(
  userId: string,
  novelId: string,
  entries: IdeaLibraryEntry[],
): void {
  const d = getDb();
  d.prepare(
    "DELETE FROM idea_library WHERE user_id = ? AND source_novel_id = ? AND source = 'extracted'"
  ).run(userId, novelId);
  saveIdeasBatch(userId, entries);
}

// ---- Analysis workspace staging (until user confirms finish) ----

export function saveAnalysisWorkspaceRow(
  userId: string,
  novelId: string,
  branchId: string,
  data: unknown,
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO analysis_workspace (user_id, novel_id, branch_id, data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(userId || "guest", novelId, branchId || "main", JSON.stringify(data));
}

export function loadAnalysisWorkspaceRow(
  userId: string,
  novelId: string,
  branchId: string,
): unknown | null {
  const d = getDb();
  const row = d
    .prepare(
      "SELECT data FROM analysis_workspace WHERE user_id = ? AND novel_id = ? AND branch_id = ?",
    )
    .get(userId || "guest", novelId, branchId || "main") as { data: string } | undefined;
  if (!row?.data) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export function deleteAnalysisWorkspaceRow(
  userId: string,
  novelId: string,
  branchId: string,
): void {
  getDb()
    .prepare(
      "DELETE FROM analysis_workspace WHERE user_id = ? AND novel_id = ? AND branch_id = ?",
    )
    .run(userId || "guest", novelId, branchId || "main");
}
