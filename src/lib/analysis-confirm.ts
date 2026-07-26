/** Pure helpers safe for client + server (no DB). */

/** User clicked end-of-analysis "save" option (or typed a save request). */
export function isUserConfirmSave(answer: string): boolean {
  const a = (answer || "").trim();
  if (!a) return false;
  if (a === "保存" || a === "确认保存") return true;
  // Explicit save phrases (option labels + free text)
  if (
    /确认保存|保存到本书|保存到库|确认落库|保存分析结果|保存并结束|保存结果|写入本书|落库|保存本书|保存名单|保存角色|保存分析/.test(
      a,
    )
  ) {
    return true;
  }
  // "好的，保存" / "是，写入本书" — must mention save AND assent
  if (/(保存|落库|写入本书)/.test(a) && /(确认|是|好|要|请|写入|本书|结果|分析|行)/.test(a)) {
    return true;
  }
  return false;
}
