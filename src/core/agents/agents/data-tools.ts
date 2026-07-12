import type { ToolDefinition } from "../types";

export const dataTools: ToolDefinition[] = [
  {
    name: "get_novel_context",
    description: "获取续写点之前的上下文。返回最近前文。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: ctx.novelText || "无前文",
      messages: [],
    }),
  },
  {
    name: "get_characters",
    description: "获取角色档案。返回角色名和性格描述。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        (ctx.characters || []).map((c: any) => ({
          name: c.name,
          desc: c.personality?.description?.slice(0, 150),
        })),
        null, 2
      ),
      messages: [],
    }),
  },
  {
    name: "get_timeline",
    description: "获取前文章节摘要。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        (ctx.timeline?.chapters || []).slice(-10),
        null, 2
      ) || "无数据",
      messages: [],
    }),
  },
  {
    name: "get_codex",
    description: "获取创作法典数据。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(
        { world: ctx.worldBible || {}, foreshadowing: [] },
        null, 2
      ),
      messages: [],
    }),
  },
  {
    name: "get_world_bible",
    description: "获取世界观设定。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => ({
      content: JSON.stringify(ctx.worldBible || {}, null, 2),
      messages: [],
    }),
  },
];
