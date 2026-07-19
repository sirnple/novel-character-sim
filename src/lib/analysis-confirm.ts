/** Pure helpers safe for client + server (no DB). */

/** User clicked end-of-analysis "save" option */
export function isUserConfirmSave(answer: string): boolean {
  const a = (answer || "").trim();
  return (
    /确认保存|保存到本书|保存到库|确认落库|保存分析结果|保存并结束|保存结果|写入本书|落库/.test(
      a,
    ) || a === "保存"
  );
}
