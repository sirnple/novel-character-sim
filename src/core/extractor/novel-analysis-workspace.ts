/**
 * Workspace for novel analysis master + domain sub-agents.
 * In-memory cache + SQLite staging until user confirms finish_novel_analysis.
 */
import type {
  StoryInfo,
  WritingStyle,
  NovelFormProfile,
  ChapterTimeline,
  ChapterCatalogEntry,
  CharacterProfile,
} from "@/types";
import type { IdeaLibraryEntry } from "@/types";
import type { TextUnit } from "./character-name-units";
import {
  saveAnalysisWorkspaceRow,
  loadAnalysisWorkspaceRow,
  deleteAnalysisWorkspaceRow,
} from "@/lib/db";

export interface NovelAnalysisWorkspace {
  fullText: string;
  modules: string[];
  forceRefresh: boolean;
  form: NovelFormProfile | null;
  /** Intermediate form draft (before submit_form) */
  formDraft: NovelFormProfile | null;
  /** Intermediate chapter catalog from scan_chapter_catalog */
  formCatalog: ChapterCatalogEntry[] | null;
  formCatalogHints: string[];
  units: TextUnit[];
  storyInfo: StoryInfo | null;
  /** Role profiles staged in session — DB only on finish_novel_analysis */
  charactersDraft: CharacterProfile[] | null;
  /** Staged relationship edges (applied onto characters at commit) */
  relationshipEdges: Array<Record<string, unknown>> | null;
  timeline: ChapterTimeline | null;
  style: WritingStyle | null;
  ideas: IdeaLibraryEntry[] | null;
  /** free-form notes / errors */
  notes: string[];
  updatedAt: string;
}

type Store = Map<string, NovelAnalysisWorkspace>;

function store(): Store {
  const g = globalThis as typeof globalThis & { __ncsNovelAnalysisWs?: Store };
  if (!g.__ncsNovelAnalysisWs) g.__ncsNovelAnalysisWs = new Map();
  return g.__ncsNovelAnalysisWs;
}

function key(userId: string, novelId: string, branchId = "main") {
  return `${userId || "guest"}::${novelId}::${branchId || "main"}`;
}

function emptyWs(
  fullText: string,
  modules: string[] = [],
  forceRefresh = false,
): NovelAnalysisWorkspace {
  return {
    fullText,
    modules,
    forceRefresh,
    form: null,
    formDraft: null,
    formCatalog: null,
    formCatalogHints: [],
    units: [],
    storyInfo: null,
    charactersDraft: null,
    relationshipEdges: null,
    timeline: null,
    style: null,
    ideas: null,
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}

function persist(
  userId: string,
  novelId: string,
  branchId: string,
  ws: NovelAnalysisWorkspace,
): void {
  // Do not dump multi-MB fullText into SQLite if huge — keep in memory only for text
  const { fullText, ...rest } = ws;
  const slim = {
    ...rest,
    // Keep short text; long prose reloaded from novel/branch on hydrate
    fullText: fullText.length <= 200_000 ? fullText : "",
    _fullTextLen: fullText.length,
  };
  try {
    saveAnalysisWorkspaceRow(userId, novelId, branchId, slim);
  } catch (e) {
    console.warn("[analysis-ws] persist failed:", (e as Error).message);
  }
}

function hydrateFromDb(
  userId: string,
  novelId: string,
  branchId: string,
): NovelAnalysisWorkspace | null {
  const raw = loadAnalysisWorkspaceRow(userId, novelId, branchId) as
    | (Partial<NovelAnalysisWorkspace> & { _fullTextLen?: number })
    | null;
  if (!raw || typeof raw !== "object") return null;
  const base = emptyWs("", [], false);
  const ws: NovelAnalysisWorkspace = {
    ...base,
    ...raw,
    formCatalogHints: Array.isArray(raw.formCatalogHints) ? raw.formCatalogHints : [],
    units: Array.isArray(raw.units) ? raw.units : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    charactersDraft: Array.isArray(raw.charactersDraft) ? raw.charactersDraft : null,
    relationshipEdges: Array.isArray((raw as any).relationshipEdges)
      ? ((raw as any).relationshipEdges as Array<Record<string, unknown>>)
      : null,
    fullText: typeof raw.fullText === "string" ? raw.fullText : "",
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
  return ws;
}

export function beginNovelAnalysisWorkspace(
  userId: string,
  novelId: string,
  branchId: string,
  data: { fullText: string; modules?: string[]; forceRefresh?: boolean },
): NovelAnalysisWorkspace {
  const existing = getNovelAnalysisWorkspace(userId, novelId, branchId);
  // forceRefresh: reset staging; else keep staged domain results, refresh text
  if (existing && !data.forceRefresh) {
    existing.fullText = data.fullText || existing.fullText;
    if (data.modules) existing.modules = data.modules;
    existing.updatedAt = new Date().toISOString();
    store().set(key(userId, novelId, branchId), existing);
    persist(userId, novelId, branchId, existing);
    return existing;
  }
  const ws = emptyWs(data.fullText, data.modules || [], !!data.forceRefresh);
  store().set(key(userId, novelId, branchId), ws);
  persist(userId, novelId, branchId, ws);
  return ws;
}

export function getNovelAnalysisWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): NovelAnalysisWorkspace | null {
  const k = key(userId, novelId, branchId);
  const mem = store().get(k);
  if (mem) return mem;
  const fromDb = hydrateFromDb(userId, novelId, branchId);
  if (fromDb) {
    // Reload fullText from novel if stripped
    if (!fromDb.fullText?.trim()) {
      try {
        const { getBranchProse, getNovel } = require("@/lib/db") as typeof import("@/lib/db");
        const { text } = getBranchProse(userId, novelId, branchId);
        fromDb.fullText = text || getNovel(userId, novelId)?.text || "";
      } catch { /* ignore */ }
    }
    store().set(k, fromDb);
    return fromDb;
  }
  return null;
}

export function patchNovelAnalysisWorkspace(
  userId: string,
  novelId: string,
  branchId: string,
  patch: Partial<NovelAnalysisWorkspace>,
): NovelAnalysisWorkspace | null {
  let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (!ws) {
    ws = beginNovelAnalysisWorkspace(userId, novelId, branchId, {
      fullText: patch.fullText || "",
    });
  }
  Object.assign(ws, patch, { updatedAt: new Date().toISOString() });
  store().set(key(userId, novelId, branchId), ws);
  persist(userId, novelId, branchId, ws);
  return ws;
}

export function clearNovelAnalysisWorkspace(
  userId: string,
  novelId: string,
  branchId = "main",
): void {
  store().delete(key(userId, novelId, branchId));
  try {
    deleteAnalysisWorkspaceRow(userId, novelId, branchId);
  } catch { /* ignore */ }
}

export function ensureAnalysisWorkspace(
  userId: string,
  novelId: string,
  branchId: string,
  fullTextFallback?: string,
): NovelAnalysisWorkspace | null {
  let ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (ws) return ws;
  if (fullTextFallback != null) {
    return beginNovelAnalysisWorkspace(userId, novelId, branchId, {
      fullText: fullTextFallback,
    });
  }
  return null;
}
