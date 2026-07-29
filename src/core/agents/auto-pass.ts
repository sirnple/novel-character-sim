/**
 * One-click continue: auto-answer master ask_question without waiting for the user.
 *
 * Quality gates are NOT skipped. When review fails, prefer "fix" options
 * until pass; only accept continuation when options imply clean accept after pass.
 */

/** Prefer fixing / rewriting when review found problems */
const FIX_PATTERNS: RegExp[] = [
  /按审核意见修改大纲/,
  /按审查意见修改正文/,
  /修改大纲/,
  /修改正文/,
  /重写大纲/,
  /换个方向重写/,
  /只改致命/,
  /只改重要/,
  /再改/,
  /改写大纲/,
  /改写正文/,
];

/** Proceed only when quality is already OK (or pure progress, not "accept risk") */
const PROCEED_SAFE_PATTERNS: RegExp[] = [
  /继续写正文/,
  /接受续写/,
  /无需修改/,
  /直接接受(?!风险)/,
];

/** Never auto-pick: knowingly ignore findings / accept with known defects */
const RISK_SKIP_PATTERNS: RegExp[] = [
  /仍按此大纲/,
  /我了解风险/,
  /跳过修改/,
  /先不接受/,
  /不接受/,
  /暂停/,
  /了解风险/,
  /仍要继续/,
  /强制/,
];

function isRiskSkip(opt: string): boolean {
  return RISK_SKIP_PATTERNS.some((p) => p.test(opt));
}

function isFix(opt: string): boolean {
  return FIX_PATTERNS.some((p) => p.test(opt));
}

function isProceedSafe(opt: string): boolean {
  return PROCEED_SAFE_PATTERNS.some((p) => p.test(opt)) && !isRiskSkip(opt);
}

/**
 * Detect whether the checkpoint is about failed review / need-to-fix.
 */
function looksLikeFailedReviewGate(question: string, options: string[]): boolean {
  const blob = `${question}\n${options.join("\n")}`;
  if (/未通过|致命|critical|major|有问题|需修改|审查意见|审核意见|findings/i.test(blob)) {
    return true;
  }
  // Options include both fix and risk-skip → treat as post-fail gate
  const hasFix = options.some(isFix);
  const hasRisk = options.some(isRiskSkip);
  return hasFix && hasRisk;
}

/**
 * Choose an auto answer for an ask_question checkpoint under 一键续写.
 * - Failed review → pick fix/rewrite, never "accept risk"
 * - Passed / clean → pick continue write or accept continuation
 */
export function pickAutoPassAnswer(question: string, options: string[]): string {
  const q = String(question || "").trim();
  const opts = (options || []).map((o) => String(o).trim()).filter(Boolean);

  if (opts.length === 0) {
    if (looksLikeFailedReviewGate(q, [])) {
      return "按审查意见修改";
    }
    if (/接受|写入|落定/i.test(q)) {
      return "接受续写（写入分支；伏笔按实际落实记账）";
    }
    if (/大纲|写正文|审核/.test(q)) {
      return "继续写正文";
    }
    return "继续";
  }

  const failed = looksLikeFailedReviewGate(q, opts);

  if (failed) {
    const fixHit = opts.find(isFix);
    if (fixHit) return fixHit;
    // Prefer anything that is not risk-skip
    const nonRisk = opts.find((o) => !isRiskSkip(o));
    if (nonRisk) return nonRisk;
    return opts[0];
  }

  // Clean path: proceed to write or accept
  for (const pat of PROCEED_SAFE_PATTERNS) {
    const hit = opts.find((o) => pat.test(o) && !isRiskSkip(o));
    if (hit) return hit;
  }

  // If options still look like "modify vs accept" after reviews, prefer fix if critical wording
  if (/问题|审查|findings|修改/i.test(q)) {
    const fixHit = opts.find(isFix);
    if (fixHit) return fixHit;
  }

  const safe = opts.find((o) => !isRiskSkip(o));
  return safe || opts[0];
}

/** Appended to master system prompt when autoPassCheckpoints is on. */
export const ONE_CLICK_CONTINUE_SYSTEM_APPEND = `
## 一键续写模式（强制生效）
用户启用了一键续写：全流程自动推进，**不要等待人工确认**；但**审核不是自动放过**。

### 质量闸门（必须遵守）
- **有问题 → 改到没问题**。大纲审核或正文审查含 critical/major（或「未通过」）时：
  - 立刻改：generate_outline 按 findings 改写 / write_prose \`[MODE:rewrite]\` 按 findings 改写
  - 改完再审（大纲会自动审；正文再 run_reviews → get_findings）
  - **循环直到通过**（或仅剩 minor 可接受）
- **禁止**选「仍按此大纲 / 我了解风险 / 跳过修改」等带病放行选项
- **禁止**隐瞒 findings 直接写正文或 accept_continuation

### 流程
1. **禁止**用 ask_question 等人（系统若见到会自动代答；代答也会优先「修改」而非「带病通过」）。
2. 大纲：generate_outline（系统自动审；未通过会自动改写一轮）。若 tool_result 仍含【大纲审核未通过】→ 你再 generate_outline 带 findings，直到通过或仅 minor。
3. 大纲通过后 → 立刻 write_prose \`[MODE:create]\`。
4. write_prose 必须等到「已 save_prose / 正文已创建」；失败 → 再拉 write_prose。
5. 成功后 → run_reviews → get_findings：
   - 有 critical/major → write_prose \`[MODE:rewrite]\` → 再 run_reviews，直到无 critical/major
   - 无 critical/major → 立刻 accept_continuation
6. 工具彻底失败才停并说明原因。
7. 结束时用一小段中文汇报（大纲、是否改过、审查是否通过、已接受写入）。
`.trim();
