// ============================================================
// Codex Updater — Update Codex state after each chapter
// ============================================================

import type { WritersCodex, ReviewReport, ChapterSummary } from "./types";

/**
 * Apply review findings to update the Codex for the next chapter.
 * Returns a new Codex with updated character states, foreshadowing, and summaries.
 */
export function updateCodexAfterChapter(
  codex: WritersCodex,
  review: ReviewReport,
  chapterNumber: number,
  chapterTitle: string
): WritersCodex {
  const next = structuredClone(codex);

  // Update character states from review findings
  for (const stateUpdate of review.updatedStates) {
    const idx = next.characterDossiers.currentStates.findIndex(
      s => s.characterId === stateUpdate.characterId
    );
    if (idx >= 0) {
      next.characterDossiers.currentStates[idx] = {
        ...next.characterDossiers.currentStates[idx],
        ...stateUpdate,
        lastChapterSeen: chapterNumber,
      } as typeof next.characterDossiers.currentStates[number];
    }
  }

  // Add new foreshadowing entries
  if (review.newForeshadowing && review.newForeshadowing.length > 0) {
    next.foreshadowingLedger.active.push(...review.newForeshadowing);
  }

  // Mark revealed foreshadowing
  for (const id of review.revealedForeshadowing || []) {
    const entry = next.foreshadowingLedger.active.find(e => e.id === id);
    if (entry) {
      entry.status = "revealed";
      entry.revealedAt = `第${chapterNumber}章`;
      next.foreshadowingLedger.revealed.push(entry);
    }
  }
  next.foreshadowingLedger.active = next.foreshadowingLedger.active.filter(
    e => e.status !== "revealed"
  );

  // Add new chapter summary
  if (review.newChapterSummary) {
    next.narrativeContext.chapterSummaries.push(review.newChapterSummary);
  }

  // Rolling truncation: keep last 10 chapter summaries
  if (next.narrativeContext.chapterSummaries.length > 10) {
    const oldSummaries = next.narrativeContext.chapterSummaries.slice(0, -10);
    const compressed = compressOldSummaries(oldSummaries);
    next.narrativeContext.chapterSummaries = [
      {
        chapterNumber: 0,
        title: "前情提要",
        summary: compressed,
        keyEvents: [],
        characterChanges: {},
      },
      ...next.narrativeContext.chapterSummaries.slice(-10),
    ];
  }

  return next;
}

function compressOldSummaries(summaries: ChapterSummary[]): string {
  return summaries.map(c => `第${c.chapterNumber}章: ${c.summary.slice(0, 100)}`).join(" | ");
}
