import Database from "better-sqlite3";
import path from "path";
import type {
  CharacterProfile, StoryInfo, SimulationState, ChapterTimeline, CharacterChapterState,
  StyleLibraryEntry, IdeaLibraryEntry, WritingStyle,
} from "@/types";

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
  // Migrate branches table to (novel_id, id, user_id) PK so multiple novels can each have id="main".
  try {
    const cols = d.prepare("PRAGMA table_info(branches)").all() as { name: string }[];
    if (cols.length > 0) {
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
    CREATE TABLE IF NOT EXISTS timelines (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chapter_states (
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, user_id)
    );

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

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'guest',
      name TEXT NOT NULL DEFAULT '',
      parent_offset INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
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


// ---- Timeline ----

export function saveTimeline(userId: string, novelId: string, timeline: ChapterTimeline): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO timelines (novel_id, user_id, data) VALUES (?, ?, ?)`
  ).run(novelId, userId, JSON.stringify(timeline));
}

export function getTimeline(userId: string, novelId: string): ChapterTimeline | null {
  const d = getDb();
  const row = d.prepare("SELECT data FROM timelines WHERE novel_id = ? AND user_id = ?").get(novelId, userId) as any;
  return row ? JSON.parse(row.data) : null;
}

// ---- Chapter States ----

export function saveChapterStates(userId: string, novelId: string, states: CharacterChapterState[]): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO chapter_states (novel_id, user_id, data) VALUES (?, ?, ?)`
  ).run(novelId, userId, JSON.stringify(states));
}

export function getChapterStates(userId: string, novelId: string): CharacterChapterState[] {
  const d = getDb();
  const row = d.prepare("SELECT data FROM chapter_states WHERE novel_id = ? AND user_id = ?").get(novelId, userId) as any;
  return row ? JSON.parse(row.data) : [];
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

export interface BranchRow {
  id: string;
  novel_id: string;
  name: string;
  parent_offset: number;
  text: string;
  created_at: string;
  updated_at: string;
}

export function saveBranch(
  userId: string,
  branchId: string,
  novelId: string,
  name: string,
  parentOffset: number,
  text: string
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO branches (id, novel_id, user_id, name, parent_offset, text, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(branchId, novelId, userId, name, parentOffset, text);
}

export function appendBranchContent(
  userId: string,
  novelId: string,
  branchId: string,
  newContent: string
): void {
  const d = getDb();
  const branch = d.prepare(
    "SELECT text FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).get(novelId, branchId, userId) as { text: string } | undefined;
  if (!branch) return;
  const combined = branch.text + "\n\n" + newContent;
  d.prepare(
    "UPDATE branches SET text = ?, updated_at = datetime('now') WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).run(combined, novelId, branchId, userId);
}

export function getBranch(
  userId: string,
  novelId: string,
  branchId: string
): BranchRow | null {
  const d = getDb();
  return getBranchByNovelAndId(d, userId, novelId, branchId);
}

export function getBranchByNovelAndId(
  d: Database.Database,
  userId: string,
  novelId: string,
  branchId: string
): BranchRow | null {
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE novel_id = ? AND id = ? AND user_id = ?"
  ).get(novelId, branchId, userId) as BranchRow | null;
}

export function listBranches(
  userId: string,
  novelId: string
): BranchRow[] {
  const d = getDb();
  return d.prepare(
    "SELECT id, novel_id, name, parent_offset, text, created_at, updated_at FROM branches WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC"
  ).all(novelId, userId) as BranchRow[];
}

export function ensureMainBranch(userId: string, novelId: string): void {
  const d = getDb();
  const existing = getBranchByNovelAndId(d, userId, novelId, "main");
  if (existing) return;
  const novel = getNovel(userId, novelId);
  const text = novel?.text || "";
  saveBranch(userId, "main", novelId, "主线", 0, text);
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
  const title = (novelTitle || "").trim() || novelId;
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
