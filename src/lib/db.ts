import Database from "better-sqlite3";
import path from "path";
import type { CharacterProfile, StoryInfo, SimulationState } from "@/types";

const DB_PATH = path.join(process.cwd(), "data", "novels.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dir = path.dirname(DB_PATH);
    const fs = require("fs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      total_length INTEGER DEFAULT 0,
      language TEXT DEFAULT 'zh',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS story_info (
      novel_id TEXT PRIMARY KEY REFERENCES novels(id),
      data TEXT NOT NULL, -- JSON
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      data TEXT NOT NULL, -- JSON
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS simulations (
      id TEXT PRIMARY KEY,
      novel_id TEXT REFERENCES novels(id),
      data TEXT NOT NULL, -- JSON
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id);
    CREATE INDEX IF NOT EXISTS idx_simulations_novel ON simulations(novel_id);
  `);
}

// ---- Novel CRUD ----

export function saveNovel(id: string, title: string, text: string): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO novels (id, title, text, total_length, language, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, title, text, text.length, "zh");
}

export function getNovel(id: string): { title: string; text: string } | null {
  const d = getDb();
  return d.prepare("SELECT title, text FROM novels WHERE id = ?").get(id) as any || null;
}

export function listNovels(): { id: string; title: string; total_length: number; created_at: string }[] {
  const d = getDb();
  return d.prepare("SELECT id, title, total_length, created_at FROM novels ORDER BY updated_at DESC").all() as any[];
}

export function deleteNovel(id: string): void {
  const d = getDb();
  d.prepare("DELETE FROM novels WHERE id = ?").run(id);
  d.prepare("DELETE FROM story_info WHERE novel_id = ?").run(id);
  d.prepare("DELETE FROM characters WHERE novel_id = ?").run(id);
}

// ---- Story Info ----

export function saveStoryInfo(novelId: string, info: StoryInfo): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO story_info (novel_id, data) VALUES (?, ?)`
  ).run(novelId, JSON.stringify(info));
}

export function getStoryInfo(novelId: string): StoryInfo | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM story_info WHERE novel_id = ?").get(novelId) as any;
  return row ? JSON.parse(row.data) : null;
}

// ---- Characters ----

export function saveCharacters(novelId: string, characters: CharacterProfile[]): void {
  const d = getDb();
  d.prepare("DELETE FROM characters WHERE novel_id = ?").run(novelId);
  const insert = d.prepare(
    "INSERT INTO characters (id, novel_id, data) VALUES (?, ?, ?)"
  );
  const tx = d.transaction((chars: CharacterProfile[]) => {
    for (const c of chars) {
      insert.run(c.id, novelId, JSON.stringify(c));
    }
  });
  tx(characters);
}

export function getCharacters(novelId: string): CharacterProfile[] {
  const d = getDb();
  const rows = d.prepare("SELECT data FROM characters WHERE novel_id = ?").all(novelId) as any[];
  return rows.map((r: any) => JSON.parse(r.data));
}

// ---- Simulations ----

export function saveSimulation(sim: SimulationState): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO simulations (id, novel_id, data) VALUES (?, ?, ?)`
  ).run(sim.id, sim.novelTitle, JSON.stringify(sim));
}

export function getSimulation(id: string): SimulationState | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM simulations WHERE id = ?").get(id) as any;
  return row ? JSON.parse(row.data) : null;
}

export function listSimulations(novelId?: string): { id: string; novel_id: string; data: string; created_at: string }[] {
  const d = getDb();
  if (novelId) {
    return d.prepare("SELECT * FROM simulations WHERE novel_id = ? ORDER BY created_at DESC").all(novelId) as any[];
  }
  return d.prepare("SELECT * FROM simulations ORDER BY created_at DESC").all() as any[];
}
