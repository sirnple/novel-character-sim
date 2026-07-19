/**
 * Commit staged analysis workspace → permanent tables / libraries.
 * Called only after user confirms save (finish_novel_analysis / commit API).
 */
import {
  getNovelAnalysisWorkspace,
  clearNovelAnalysisWorkspace,
} from "@/core/extractor/novel-analysis-workspace";
import { getCharacterExtractWorkspace } from "@/core/extractor/character-extract-workspace";
import { buildFormDraftFromText } from "@/core/form/form-analyzer";
import { entitiesToProfiles } from "./agents/character-extract-tools";
import {
  applyRelationshipEdges,
  mergeCharacterProfiles,
  nameKey,
  profileHasDetail,
} from "./character-draft-utils";
import type { CharacterProfile } from "@/types";
import {
  saveNovelForm,
  saveBranchChapterMeta,
  getBranchChapterMeta,
  saveCharacters,
  getCharacters,
  saveStoryInfo,
  getStoryInfo,
  saveTimeline,
  getTimeline,
  getNovelForm,
  upsertExtractedStyle,
  replaceExtractedIdeas,
  listStyles,
  listIdeas,
  getNovel,
  listBranches,
  getBranchProse,
} from "@/lib/db";

function resolveBookTitle(userId: string, novelId: string): string {
  const novel = getNovel(userId, novelId);
  const t = (novel?.title || "").trim();
  if (t && t !== novelId) return t;
  const branches = listBranches(userId, novelId);
  const named = branches.find((b) => b.name && b.name !== "主线" && b.name !== "main");
  if (named?.name?.trim()) return named.name.trim();
  return t || novelId;
}

function loadText(userId: string, novelId: string, branchId: string): string {
  const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  if (ws?.fullText) return ws.fullText;
  const { text } = getBranchProse(userId, novelId, branchId);
  if (text?.trim()) return text;
  return getNovel(userId, novelId)?.text || "";
}

export { isUserConfirmSave } from "@/lib/analysis-confirm";

export function commitAnalysisWorkspace(input: {
  userId: string;
  novelId: string;
  branchId?: string;
}): {
  ok: boolean;
  content: string;
  committed: string[];
  skipped: string[];
  characters: number;
} {
  const userId = input.userId || "guest";
  const novelId = input.novelId;
  const branchId = input.branchId || "main";
  const text = loadText(userId, novelId, branchId);
  const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
  const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
  const committed: string[] = [];
  const skipped: string[] = [];

  const form = ws?.form || ws?.formDraft || null;
  let catalog = ws?.formCatalog || [];
  if (form) {
    if (!catalog.length) {
      catalog = buildFormDraftFromText(novelId, text).catalog;
    }
    for (let i = 0; i < catalog.length; i++) {
      catalog[i] = {
        ...catalog[i],
        endOffset:
          i + 1 < catalog.length ? catalog[i + 1].startOffset : text.length,
      };
    }
    saveNovelForm(userId, novelId, form);
    const existingMeta = getBranchChapterMeta(userId, novelId, branchId);
    saveBranchChapterMeta(userId, {
      ...existingMeta,
      novelId,
      branchId,
      chapters: catalog,
      chapterBoundary: existingMeta.chapterBoundary || "closed",
      updatedAt: new Date().toISOString(),
    });
    committed.push(`form+catalog(${catalog.length})`);
  } else if (getNovelForm(userId, novelId)) {
    skipped.push("form(already in DB)");
  } else {
    skipped.push("form(missing)");
  }

  // Merge: DB existing (if any) ← entities stubs ← charactersDraft (richest wins)
  const byKey = new Map<string, CharacterProfile>();
  for (const c of getCharacters(userId, novelId)) {
    byKey.set(nameKey(c.name), c);
  }
  if (cws?.entities?.length) {
    for (const p of entitiesToProfiles(cws.entities)) {
      const k = nameKey(p.name);
      byKey.set(k, byKey.has(k) ? mergeCharacterProfiles(byKey.get(k)!, p) : p);
    }
  }
  if (Array.isArray(ws?.charactersDraft)) {
    for (const p of ws!.charactersDraft!) {
      if (!p?.name) continue;
      const k = nameKey(p.name);
      byKey.set(k, byKey.has(k) ? mergeCharacterProfiles(byKey.get(k)!, p) : p);
    }
  }
  // Apply staged relationship edges last
  let chars = Array.from(byKey.values());
  if (ws?.relationshipEdges?.length) {
    chars = applyRelationshipEdges(chars, ws.relationshipEdges).chars;
  }
  chars = chars
    .filter((c) => c && String(c.name || "").trim())
    .map((c, i) => ({
      ...c,
      id: c.id || `char_${i}_${nameKey(c.name).slice(0, 24)}`,
      name: String(c.name).trim(),
      aliases: Array.isArray(c.aliases) ? c.aliases : [],
      relationships: Array.isArray(c.relationships) ? c.relationships : [],
    }));

  const richN = chars.filter(profileHasDetail).length;
  const relN = chars.reduce((n, c) => n + (c.relationships?.length || 0), 0);

  if (chars.length) {
    try {
      saveCharacters(userId, novelId, chars as any);
      const n = getCharacters(userId, novelId).length;
      if (n > 0) {
        committed.push(`characters(${n},detail=${richN},rels=${relN})`);
      } else {
        skipped.push("characters(save returned empty)");
      }
    } catch (e) {
      skipped.push("characters(error:" + (e as Error).message + ")");
      console.warn("[commit-analysis] saveCharacters failed:", e);
    }
  } else {
    skipped.push("characters(missing — no draft/entities/DB)");
    console.warn("[commit-analysis] no characters to commit", {
      userId,
      novelId,
      hasWs: !!ws,
      draftLen: ws?.charactersDraft?.length ?? 0,
      edges: ws?.relationshipEdges?.length ?? 0,
      entities: cws?.entities?.length ?? 0,
    });
  }

  if (ws?.storyInfo) {
    saveStoryInfo(userId, novelId, ws.storyInfo);
    committed.push("story");
  } else if (getStoryInfo(userId, novelId)?.plotSummary) {
    skipped.push("story(already in DB)");
  } else {
    skipped.push("story(missing)");
  }

  if (ws?.timeline) {
    saveTimeline(userId, novelId, ws.timeline, branchId);
    committed.push("timeline");
  } else if (getTimeline(userId, novelId, branchId)) {
    skipped.push("timeline(already in DB)");
  } else {
    skipped.push("timeline(missing)");
  }

  if (ws?.style) {
    const title = resolveBookTitle(userId, novelId);
    upsertExtractedStyle(userId, novelId, title, ws.style);
    committed.push("style");
  } else if (listStyles(userId).some((s) => s.sourceNovelId === novelId)) {
    skipped.push("style(already in library)");
  } else {
    skipped.push("style(missing)");
  }

  if (ws?.ideas?.length) {
    const bookTitle = resolveBookTitle(userId, novelId);
    const entries = ws.ideas.map((it) => ({
      ...it,
      sourceNovelId: novelId,
      sourceNovelTitle: bookTitle || it.sourceNovelTitle,
    }));
    replaceExtractedIdeas(userId, novelId, entries);
    committed.push(`ideas(${entries.length})`);
  } else if (listIdeas(userId).some((i) => i.sourceNovelId === novelId)) {
    skipped.push("ideas(already in library)");
  } else {
    skipped.push("ideas(missing)");
  }

  const nChars = getCharacters(userId, novelId).length;
  const summary = {
    committed,
    skipped,
    story: !!getStoryInfo(userId, novelId),
    form: !!getNovelForm(userId, novelId),
    characters: nChars,
    timeline: !!getTimeline(userId, novelId, branchId),
    catalog: getBranchChapterMeta(userId, novelId, branchId).chapters?.length || 0,
    bookTitle: resolveBookTitle(userId, novelId),
  };

  // Clear staging after successful commit of anything
  if (committed.length) {
    clearNovelAnalysisWorkspace(userId, novelId, branchId);
  }

  return {
    ok: committed.length > 0,
    content: `全书分析已完成 ${JSON.stringify(summary)}`,
    committed,
    skipped,
    characters: nChars,
  };
}
