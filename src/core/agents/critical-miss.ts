/**
 * Critical get_* failures: sub-agents stop and ask the user directly
 * (not wait for master to re-ask).
 */

export const CRITICAL_MISS_PREFIX = "【关键数据缺失】";

export type CriticalMissKind =
  | "outline"
  | "prose"
  | "branch_text"
  | "branch"
  | "novelId"
  | "other";

export interface AskUserPayload {
  question: string;
  options: string[];
  missKind: CriticalMissKind;
  toolName?: string;
  detail?: string;
}

const CRITICAL_GET_TOOLS = new Set([
  "get_outline",
  "get_prose",
  "get_branch_text",
]);

export function isCriticalGetTool(name: string): boolean {
  return CRITICAL_GET_TOOLS.has(name);
}

export function formatCriticalMiss(
  kind: CriticalMissKind,
  message: string,
): string {
  return `${CRITICAL_MISS_PREFIX} kind=${kind}\n${message}`;
}

export function isCriticalMissContent(content: string): boolean {
  return (content || "").includes(CRITICAL_MISS_PREFIX);
}

export function parseCriticalMiss(
  content: string,
): { kind: CriticalMissKind; message: string } | null {
  if (!isCriticalMissContent(content)) return null;
  const kindMatch = content.match(/kind=(\w+)/);
  const kind = (kindMatch?.[1] || "other") as CriticalMissKind;
  const message = content
    .replace(CRITICAL_MISS_PREFIX, "")
    .replace(/kind=\w+\s*/, "")
    .trim();
  return { kind, message };
}

/** Build ask_question payload for a failed critical get. */
export function askUserForCriticalMiss(
  toolName: string,
  resultContent: string,
): AskUserPayload {
  const parsed = parseCriticalMiss(resultContent);
  const kind = parsed?.kind || "other";
  const detail = parsed?.message || resultContent.slice(0, 300);

  const labels: Record<CriticalMissKind, string> = {
    outline: "大纲",
    prose: "待审/待改正文草稿",
    branch_text: "分支前文",
    branch: "分支",
    novelId: "小说 ID",
    other: "关键数据",
  };
  const label = labels[kind] || "关键数据";

  let options: string[];
  switch (kind) {
    case "outline":
      options = ["重新生成大纲", "取消本次写作", "仍要继续（不推荐）"];
      break;
    case "prose":
      options = ["先写正文再审/改", "取消", "仍要继续（不推荐）"];
      break;
    case "branch_text":
    case "branch":
      options = ["检查分支选择", "取消", "仍要继续（不推荐）"];
      break;
    default:
      options = ["重试", "取消", "仍要继续（不推荐）"];
  }

  return {
    question:
      `【${toolName}】无法获取${label}，是否继续？\n\n${detail.slice(0, 400)}`,
    options,
    missKind: kind,
    toolName,
    detail,
  };
}
