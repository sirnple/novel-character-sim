import type { ToolDefinition } from "../types";
import { getBranchProse, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";

const TEXT_TAIL = 30000;

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
      if (!novelId) return { content: "缺少 novelId", messages: [] };
      const { text, branch } = getBranchProse(userId, novelId, branchId);
      if (!branch) return { content: "分支不存在", messages: [] };
      const tail = text.slice(-TEXT_TAIL);
      return { content: tail || "无前文", messages: [] };
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
    description: "获取该小说的世界观设定（来自 storyInfo.worldSetting）。",
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
      return { content: JSON.stringify((info as any)?.worldSetting || {}, null, 2), messages: [] };
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
