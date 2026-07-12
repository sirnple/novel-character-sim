import type { ToolDefinition } from "../types";
import { getBranch, getCharacters, getTimeline, getStoryInfo } from "@/lib/db";

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
      const branch = getBranch(ctx.userId || "guest", args.branchId as string);
      if (!branch) return { content: "分支不存在", messages: [] };
      const text = branch.text || "";
      return { content: text.slice(-TEXT_TAIL) || "无前文", messages: [] };
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
      const chars = getCharacters(ctx.userId || "guest", args.novelId as string) || [];
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
      const tl = getTimeline(ctx.userId || "guest", args.novelId as string);
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
      const info = getStoryInfo(ctx.userId || "guest", args.novelId as string);
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
      const branch = getBranch(ctx.userId || "guest", args.branchId as string);
      if (!branch) return { content: "分支不存在", messages: [] };
      return {
        content: JSON.stringify({
          name: branch.name, parent_offset: branch.parent_offset,
          novel_id: branch.novel_id, total_chars: (branch.text || "").length,
        }, null, 2),
        messages: [],
      };
    },
  },
];
