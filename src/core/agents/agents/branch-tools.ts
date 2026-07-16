import type { ToolDefinition } from "../types";
import { getBranchProse, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";
import { formatCriticalMiss } from "../critical-miss";

const TEXT_TAIL = 30000;

/** Rough genre → logic strictness for review agents (prompt hint only). */
function inferLogicStrictnessHint(genre: string, themes?: string[]): string {
  const g = `${genre} ${(themes || []).join(" ")}`.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => g.includes(k));
  if (
    has(
      "玄幻", "仙侠", "奇幻", "修真", "修仙", "魔法", "异能", "无限", "穿越",
      "系统", "克苏鲁", "神话", "科幻", "末世", "超自然", "fantasy", "xianxia",
      "wuxia", "isekai", "litrpg",
    )
  ) {
    return "松（规则内）：允许超自然，但须符合本书已建立的规则；梦/幻境跨入现实需有本书内桥接，否则仍报。";
  }
  if (has("言情", "甜宠", "霸总", "恋爱", "romance", "轻小说")) {
    return "中：情感可夸张；身份/空间/生死/梦与现实/知情权仍须自洽。";
  }
  if (has("历史", "现实", "纪实", "社会", "严肃", "realistic", "historical")) {
    return "严：默认物理与社会常理；梦≠现实；无因知情/复活一律重报。";
  }
  if (genre.trim()) {
    return `未精确归类（genre="${genre}"）：默认中档；若正文已建立幻想规则则按规则内自洽审查。`;
  }
  return "类型未知：默认中档；对「梦境/幻觉实体进入现实」无铺垫时倾向 major。";
}

export const branchTools: ToolDefinition[] = [
  {
    name: "get_branch_text",
    description: "获取当前分支的正文尾部（最近若干字）作为续写起点。要求 novelId+branchId 双参。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      // Prefer ctx ids (authoritative from request); args may be hallucinated by LLM
      const novelId = (ctx.novelId || args.novelId || "") as string;
      const branchId = (ctx.branchId || args.branchId || "main") as string;
      if (!novelId) {
        return {
          content: formatCriticalMiss("novelId", "缺少 novelId，无法读取分支前文。"),
          messages: [],
        };
      }
      const { text, branch } = getBranchProse(userId, novelId, branchId);
      if (!branch) {
        return {
          content: formatCriticalMiss(
            "branch",
            `分支不存在（novelId=${novelId}, branchId=${branchId}）。请检查写作页分支选择。`,
          ),
          messages: [],
        };
      }
      const tail = text.slice(-TEXT_TAIL);
      // Empty IF branch is allowed (new fork); only miss when no branch row
      if (!tail) {
        return {
          content:
            "（本分支暂无正文，可从空分支续写。若应有前文，请检查是否选错分支。）",
          messages: [],
        };
      }
      return { content: tail, messages: [] };
    },
  },
  {
    name: "get_branch_characters",
    description: "获取该小说的角色档案名+性格描述。按 novelId 查。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = (ctx.novelId || args.novelId || "") as string;
      const chars = getCharacters(userId, novelId) || [];
      return {
        content: JSON.stringify(chars.map((c: any) => ({ name: c.name, desc: c.personality?.description?.slice(0, 200) })), null, 2),
        messages: [],
      };
    },
  },
  {
    name: "get_branch_timeline",
    description: "获取该小说的章节时间线。按 novelId 查。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = (ctx.novelId || args.novelId || "") as string;
      const tl = getTimeline(userId, novelId);
      return { content: JSON.stringify((tl?.chapters || []).slice(-10), null, 2) || "无数据", messages: [] };
    },
  },
  {
    name: "get_branch_world",
    description:
      "获取小说类型(genre)、主题、世界观与文风摘要。连贯/逻辑审查与世界观审查必调用，用于按类型调节审查松紧。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = (ctx.novelId || args.novelId || "") as string;
      const info = getStoryInfo(userId, novelId);
      const style = (info as any)?.writingStyle || {};
      return {
        content: JSON.stringify(
          {
            genre: style.genre || "",
            tone: style.tone || "",
            themes: (info as any)?.themes || [],
            contentRating: style.contentRating || "",
            worldSetting: (info as any)?.worldSetting || {},
            plotSummary: String((info as any)?.plotSummary || "").slice(0, 800),
            /** 给审查员的松紧提示（仍须结合正文已建立规则） */
            logicStrictnessHint: inferLogicStrictnessHint(style.genre || "", (info as any)?.themes),
          },
          null,
          2,
        ),
        messages: [],
      };
    },
  },
  {
    name: "get_branch_meta",
    description: "获取分支元信息：name/parent_offset/总字数。",
    parameters: {
      type: "object",
      properties: {
        novelId: { type: "string", description: "小说 ID" },
        branchId: { type: "string", description: "分支 ID（主线为 main）" },
      },
      required: ["novelId", "branchId"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = (ctx.novelId || args.novelId || "") as string;
      const branchId = (ctx.branchId || args.branchId || "main") as string;
      const { text, branch } = getBranchProse(userId, novelId, branchId);
      if (!branch) return { content: "分支不存在", messages: [] };
      return {
        content: JSON.stringify({
          name: branch.name,
          parent_offset: branch.parent_offset,
          novel_id: branch.novel_id,
          total_chars: text.length,
        }, null, 2),
        messages: [],
      };
    },
  },
];
