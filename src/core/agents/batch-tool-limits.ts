/**
 * Shared notices when batch lookup / unit-read hits count or output budget.
 * Prefer batch; on overflow tell the model to shrink batch or use single call.
 */

export const BATCH_TEXT_BUDGET = 16_000;

export type BatchLimitReason = "count_cap" | "output_budget";

/**
 * Footer / header when a batch could not fully return all requested items.
 * Always steers: keep batching, just smaller; single only for the leftovers if needed.
 */
export function formatBatchOverflowNotice(opts: {
  /** e.g. 称呼 / 正文位置 / 文本单元 */
  itemLabel: string;
  toolHint: string;
  requested: number;
  returned: number;
  /** Items not included (names, offsets, indices) — show a few */
  omitted: string[];
  reason: BatchLimitReason;
  countCap?: number;
  budget?: number;
}): string {
  const omittedList =
    opts.omitted.length > 0
      ? opts.omitted.slice(0, 12).join("、") +
        (opts.omitted.length > 12 ? `…等共${opts.omitted.length}项` : "")
      : "（无明细）";

  const reasonLine =
    opts.reason === "count_cap"
      ? `原因：单次最多 ${opts.countCap ?? "?"} 个${opts.itemLabel}（请求了 ${opts.requested} 个）。`
      : `原因：输出字数预算约 ${opts.budget ?? BATCH_TEXT_BUDGET} 字已满` +
        `（已返回 ${opts.returned}/${opts.requested} 个${opts.itemLabel}）。`;

  return [
    "【输出超限 / 批次未完整返回】",
    reasonLine,
    `未返回：${omittedList}`,
    "下一步（优先仍批量）：",
    `1. 缩小批量：只对「未返回」再调 ${opts.toolHint}，数量减半或 ≤5；`,
    `2. 若某条仍过长：对该条单独调用（单参）；`,
    "3. 不要对已返回的项再整批重查。",
  ].join("\n");
}
