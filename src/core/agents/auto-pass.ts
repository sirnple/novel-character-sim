/**
 * One-click continue: pick the progressive option when master asks for review gates.
 * Prefer "accept / write / proceed" over "modify / reject / pause".
 */

const PRIORITY_PATTERNS: RegExp[] = [
  /接受续写/,
  /继续写正文/,
  /仍按此大纲/,
  /我了解风险/,
  /直接接受/,
  /跳过修改/,
  /无需修改/,
  /继续(?!修改|调整)/,
];

const REJECT_PATTERNS = /修改|不接受|先不|调整方向|换个方向|重写大纲|只改|暂停/;

/**
 * Choose an auto-pass answer for an ask_question checkpoint.
 */
export function pickAutoPassAnswer(question: string, options: string[]): string {
  const q = String(question || "").trim();
  const opts = (options || []).map((o) => String(o).trim()).filter(Boolean);

  if (opts.length === 0) {
    if (/接受|写入|落定|审查|findings/i.test(q)) {
      return "接受续写（写入分支；伏笔按实际落实记账）";
    }
    if (/大纲|写正文|审核/.test(q)) {
      return "继续写正文";
    }
    return "继续";
  }

  for (const pat of PRIORITY_PATTERNS) {
    const hit = opts.find((o) => pat.test(o));
    if (hit) return hit;
  }

  const nonReject = opts.find((o) => !REJECT_PATTERNS.test(o));
  return nonReject || opts[0];
}

/** Appended to master system prompt when autoPassCheckpoints is on. */
export const ONE_CLICK_CONTINUE_SYSTEM_APPEND = `
## 一键续写模式（强制生效）
用户启用了一键续写：本回合内所有**审核卡点自动通过**，不要等待人工确认。

硬性规则：
1. **禁止**调用 ask_question 做「确认大纲 / 是否写正文 / 是否按审查修改 / 是否接受续写」类卡点。
2. 大纲 generate_outline（含自动大纲审核）完成后：简述要点后**立刻** agent(write_prose) 带 \`[MODE:create]\`，不论大纲审核是否通过。
3. write_prose 得到 save_prose 后：立刻 **run_reviews** → **get_findings**（可短摘要）→ 立刻 **accept_continuation**，不要因 findings 数量停下来问用户。
4. 若你误调了 ask_question，系统会自动代选推进选项；你收到自动通过结果后继续下一流程步骤。
5. 仅在工具彻底失败、无法继续时停止并说明原因；不要为「质量风险」停顿。
6. 全部完成后用一小段中文汇报摘要（大纲方向、是否审查、已接受写入）。
`.trim();
