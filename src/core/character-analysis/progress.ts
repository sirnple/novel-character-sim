/**
 * Live progress lines for the character-list pipeline (UI parses 【进度】…).
 *
 * Format (agent-panel `parseToolProgress`):
 *   【进度】角色列表 {overall}/100（{overall}%）· {stageName} {done}/{total}（{pct}%）· {detail}
 *
 * `stageDone` must be **completed-task count** under concurrency (not window/pair
 * index). Concurrent workers finish out of order; reporting by index makes the
 * bar jump backward/forward incorrectly.
 */

export type CharacterPipelineStageId = 1 | 2 | 3 | 4;

/** Cumulative overall % ranges (exclusive end = next start). */
export const CHARACTER_PIPELINE_STAGE_BANDS: ReadonlyArray<{
  id: CharacterPipelineStageId;
  name: string;
  startPct: number;
  endPct: number;
}> = [
  { id: 1, name: "①窗扫", startPct: 0, endPct: 55 },
  { id: 2, name: "②overlap", startPct: 55, endPct: 58 },
  { id: 3, name: "③消解", startPct: 58, endPct: 95 },
  { id: 4, name: "④命名", startPct: 95, endPct: 100 },
];

export interface CharacterPipelineProgressEvent {
  stage: CharacterPipelineStageId;
  stageDone: number;
  stageTotal: number;
  detail?: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function overallPctForStage(
  stage: CharacterPipelineStageId,
  stageDone: number,
  stageTotal: number,
): number {
  const band = CHARACTER_PIPELINE_STAGE_BANDS.find((b) => b.id === stage)!;
  const frac =
    stageTotal <= 0 ? 1 : clamp(stageDone / stageTotal, 0, 1);
  return Math.round(
    band.startPct + (band.endPct - band.startPct) * frac,
  );
}

export function formatCharacterPipelineProgress(
  ev: CharacterPipelineProgressEvent,
): string {
  const band = CHARACTER_PIPELINE_STAGE_BANDS.find((b) => b.id === ev.stage)!;
  const total = Math.max(1, ev.stageTotal | 0);
  const done = clamp(ev.stageDone | 0, 0, total);
  const stagePct = Math.round((done / total) * 100);
  const overall = overallPctForStage(ev.stage, done, total);
  const parts = [
    `【进度】角色列表 ${overall}/100（${overall}%）`,
    `${band.name} ${done}/${total}（${stagePct}%）`,
  ];
  const d = (ev.detail || "").trim();
  if (d) parts.push(d);
  return parts.join(" · ");
}
