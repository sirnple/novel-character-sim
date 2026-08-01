/** Pure helpers safe for client + server (no DB). */

/**
 * User clicked end-of-analysis "save" option (or typed a short save request).
 *
 * Must NOT match long master prompts (一键分析 instruction blobs used to hit
 * /确认保存/ inside「勿问确认保存」or /保存/+/分析/ and auto-commit before any work).
 */
export function isUserConfirmSave(answer: string): boolean {
  const a = (answer || "").trim();
  if (!a) return false;

  // Orchestration / one-click prompts are long — never a human save click
  if (a.length > 80) return false;

  // Exact option labels (common ask_question choices)
  if (
    a === "保存" ||
    a === "确认保存" ||
    a === "确认保存到本书" ||
    a === "保存到本书" ||
    a === "保存分析结果" ||
    a === "保存结果" ||
    a === "保存并结束" ||
    a === "写入本书" ||
    a === "落库" ||
    a === "确认落库" ||
    a === "保存本书" ||
    a === "保存名单" ||
    a === "保存角色" ||
    a === "保存分析"
  ) {
    return true;
  }

  // Short free text: whole message is a save request (not instructions about saving)
  // e.g. 「好的，保存」「请保存到本书」「是，写入本书」
  if (
    /^(好的?|是的?|行|嗯|可以|请)?[，,\s]*(确认)?(保存|落库)(到本书|到库|分析结果|结果|并结束|本书|名单|角色|分析)?[。.!！]?$/.test(
      a,
    )
  ) {
    return true;
  }
  if (
    /^(好的?|是的?|行|嗯|可以|请)?[，,\s]*(写入本书)[。.!！]?$/.test(a)
  ) {
    return true;
  }

  return false;
}

/**
 * User explicitly asked for a full re-analysis that should wipe staging.
 * Must be unambiguous — do not match bare「重新分析」.
 */
export function isUserForceFullReanalyze(answer: string): boolean {
  const a = (answer || "").trim();
  if (!a) return false;
  if (
    /全书强制重跑|强制全书重跑|全书覆盖重跑|清空并重跑|强制覆盖(全部|全书|重跑)|重跑全部域|全部域强制重跑/.test(
      a,
    )
  ) {
    return true;
  }
  // 「全书重跑」+ 含章法/覆盖/清空 等明确范围
  if (
    /全书重跑|全部重跑|完整重跑/.test(a) &&
    /(章法|覆盖|清空|强制|很慢|所有域|全部域)/.test(a)
  ) {
    return true;
  }
  return false;
}
