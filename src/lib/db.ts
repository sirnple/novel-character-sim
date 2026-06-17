import Database from "better-sqlite3";
import path from "path";
import type { CharacterProfile, StoryInfo, SimulationState } from "@/types";

const DB_PATH = path.join(process.cwd(), "data", "novels.db");

let db: Database.Database | null = null;

let migrated = false;

function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    const fs = require("fs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
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
function migrateOldData(d: Database.Database): void {
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
  `);

  // Migrate old tables that may be missing user_id.
  // Use exec with error suppression — SQLite has no IF NOT EXISTS for ALTER TABLE.
  for (const table of ["novels", "story_info", "characters", "simulations"]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'guest'`); console.log(`[DB] Added user_id to ${table}`); } catch { /* already exists */ }
  }
}

// ---- Novel CRUD ----

export function saveNovel(userId: string, id: string, title: string, text: string): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO novels (id, user_id, title, text, total_length, language, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, userId, title, text, text.length, "zh");
}

export function getNovel(userId: string, id: string): { title: string; text: string } | null {
  const d = getDb();
  return d.prepare("SELECT title, text FROM novels WHERE id = ? AND user_id = ?").get(id, userId) as any || null;
}

export function listNovels(userId: string): { id: string; title: string; total_length: number; created_at: string }[] {
  const d = getDb();
  return d.prepare("SELECT id, title, total_length, created_at FROM novels WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
}

export function deleteNovel(userId: string, id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM novels WHERE id = ? AND user_id = ?").run(id, userId);
  d.prepare("DELETE FROM story_info WHERE novel_id = ? AND user_id = ?").run(id, userId);
  d.prepare("DELETE FROM characters WHERE novel_id = ? AND user_id = ?").run(id, userId);
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
