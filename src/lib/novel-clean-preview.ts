/**
 * Shared preview/apply helpers for novel cleaner.
 * Spec: docs/superpowers/specs/2026-08-07-novel-cleaner-config-preview-design.md §6
 */

import {
  cleanNovelText,
  type CleanNovelOptions,
  type CleanReport,
} from "@/core/parser/novel-cleaner";
import type { NovelCleanConfig } from "@/lib/novel-clean-config";
import { getNovelCleanConfigFromRuntime } from "@/lib/runtime-settings";

/** Full cleaned text when ≤ this size; else head+tail only. */
export const CLEAN_PREVIEW_FULL_MAX_BYTES = 500 * 1024;
export const CLEAN_PREVIEW_EDGE_CHARS = 2048;
/** Max raw input for text body (align with parse 5MB for non-admin). */
export const CLEAN_PREVIEW_TEXT_MAX_CHARS = 5 * 1024 * 1024;

export interface BuildCleanPreviewInput {
  text: string;
  configOverride?: Partial<NovelCleanConfig> | null;
  excludePatterns?: string[];
  excludeLineKeys?: string[];
  maxSamples?: number;
  /** Prefer pre-resolved options when testing without runtime-settings. */
  cleanOptions?: CleanNovelOptions;
}

export interface CleanPreviewPayload {
  /** Full cleaned when small; head+tail when truncated. */
  cleanedPreview: string;
  previewMode: "full" | "head_tail";
  cleanedLength: number;
  originalLength: number;
  report: CleanReport;
  /** True when removeRatio >= warn threshold. */
  highRemoveWarning: boolean;
  /** True when removeRatio >= block threshold (apply needs force). */
  blockWithoutForce: boolean;
}

export function buildCleanPreview(
  input: BuildCleanPreviewInput,
): CleanPreviewPayload {
  const resolved =
    input.cleanOptions?.resolved ||
    getNovelCleanConfigFromRuntime(input.configOverride ?? null);

  const result = cleanNovelText(input.text, {
    ...input.cleanOptions,
    resolved,
    config: input.configOverride ?? input.cleanOptions?.config,
    excludeLineKeys: input.excludeLineKeys,
    excludePatterns: input.excludePatterns,
    maxSamples: input.maxSamples,
  });

  const cleaned = result.text;
  const cleanedLength = cleaned.length;
  let cleanedPreview = cleaned;
  let previewMode: "full" | "head_tail" = "full";

  // Use char length as proxy for UTF-8 size (CJK ≈ 3 bytes; 500KB gate is conservative enough)
  if (cleanedLength > CLEAN_PREVIEW_FULL_MAX_BYTES) {
    previewMode = "head_tail";
    const edge = CLEAN_PREVIEW_EDGE_CHARS;
    cleanedPreview =
      cleaned.slice(0, edge) +
      `\n\n…（已截断，全文 cleanedLength=${cleanedLength}）…\n\n` +
      cleaned.slice(-edge);
  }

  const removeRatio = result.report.stats.removeRatio;
  return {
    cleanedPreview,
    previewMode,
    cleanedLength,
    originalLength: result.report.stats.originalLength,
    report: result.report,
    highRemoveWarning: removeRatio >= resolved.warnRemoveRatio,
    blockWithoutForce: removeRatio >= resolved.blockRemoveRatio,
  };
}
