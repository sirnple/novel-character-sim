import fs from "node:fs";
import path from "node:path";
import type { AnalysisWindow } from "./types";
import { splitWindowByOverlap } from "./windows";

const PROMPT_REL = path.join(
  "src",
  "core",
  "character-analysis",
  "prompts",
  "extract-window.md",
);

export function extractWindowPromptPath(cwd = process.cwd()): string {
  return path.join(cwd, PROMPT_REL);
}

/** Read every call so manual prompt edits apply next request. */
export function loadExtractWindowPromptTemplate(cwd = process.cwd()): string {
  const p = extractWindowPromptPath(cwd);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing extract-window prompt: ${p}`);
  }
  return fs.readFileSync(p, "utf-8");
}

export interface RenderExtractWindowOptions {
  cwd?: string;
  /** Previous window (for head overlap zone). */
  prev?: AnalysisWindow | null;
  /** Next window (for tail overlap zone). */
  next?: AnalysisWindow | null;
}

/**
 * Build the partitioned body shown to the model (overlap vs middle).
 */
export function formatWindowBodyForPrompt(
  window: AnalysisWindow,
  prev?: AnalysisWindow | null,
  next?: AnalysisWindow | null,
): string {
  const { prefixOverlap, middle, suffixOverlap, hasAnyOverlap } =
    splitWindowByOverlap(window, prev, next);

  if (!hasAnyOverlap) {
    return [
      `（本窗无相邻重叠区 → 单数「你/他/她」不收；专名/称呼可收；若第一人称叙述仍须建叙述者「我」）`,
      ``,
      `【主体 · 全窗】`,
      window.text,
    ].join("\n");
  }

  const parts: string[] = [];
  if (prefixOverlap) {
    parts.push(
      `【前重叠区 · 与上一窗共享 · 窗头】`,
      `（姓名/称呼可收；默认不收单数你/他/她/它/您 — 上文不足易绑错；集体我们/你们/他们忽略；不确定不绑）`,
      prefixOverlap,
      ``,
    );
  }
  if (middle) {
    parts.push(
      `【主体 · 非重叠】`,
      `（姓名/称呼 + 第一人称叙述者「我」；不要收你/他/她；集体忽略）`,
      middle,
      ``,
    );
  }
  if (suffixOverlap) {
    parts.push(
      `【后重叠区 · 与下一窗共享 · 窗尾】`,
      `（姓名/称呼可收；单数你/他/她仅在能明确绑定本窗人物时收，「你」=听话人；无标记对白推不出则不收；集体忽略）`,
      suffixOverlap,
      ``,
    );
  }
  return parts.join("\n").trimEnd();
}

export function renderExtractWindowPrompt(
  window: AnalysisWindow,
  options: RenderExtractWindowOptions | string = {},
): string {
  // Back-compat: second arg was cwd string
  const opts: RenderExtractWindowOptions =
    typeof options === "string" ? { cwd: options } : options;
  const cwd = opts.cwd ?? process.cwd();
  const template = loadExtractWindowPromptTemplate(cwd);
  const windowBody = formatWindowBodyForPrompt(
    window,
    opts.prev,
    opts.next,
  );
  return template
    .replace(/\{\{windowBody\}\}/g, windowBody)
    .replace(/\{\{windowText\}\}/g, window.text)
    .replace(/\{\{windowLabel\}\}/g, window.label)
    .replace(/\{\{windowIndex\}\}/g, String(window.index));
}
